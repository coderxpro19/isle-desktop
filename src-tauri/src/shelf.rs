//! The file shelf: files dropped on the island are kept as references (not
//! copied) and can be dragged back out to any app or folder.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: u64,
}

pub fn info(path: &str) -> FileInfo {
    let p = std::path::Path::new(path);
    let meta = std::fs::metadata(p).ok();
    FileInfo {
        path: path.to_string(),
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string()),
        exists: meta.is_some(),
        is_dir: meta.as_ref().is_some_and(|m| m.is_dir()),
        size: meta.as_ref().filter(|m| m.is_file()).map_or(0, |m| m.len()),
    }
}

#[tauri::command]
pub fn shelf_info(paths: Vec<String>) -> Vec<FileInfo> {
    paths.iter().map(|p| info(p)).collect()
}

#[tauri::command]
pub async fn shelf_thumb(path: String) -> Option<String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || crate::dock::thumbnail(&path))
        .await
        .ok()
        .flatten();
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

#[tauri::command]
pub fn shelf_open(path: String) -> Result<(), String> {
    crate::dock::open_shell(&path)
}

#[tauri::command]
pub fn shelf_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("not supported on this platform".into())
    }
}

/// Start a native drag of `paths` from the calling window (mouse button must be down).
#[tauri::command]
pub fn shelf_drag(
    app: AppHandle,
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<(), String> {
    let paths: Vec<String> = paths.into_iter().filter(|p| info(p).exists).collect();
    if paths.is_empty() {
        return Err("those files no longer exist".into());
    }
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        app.run_on_main_thread(move || {
            if let Err(e) = platform::drag(hwnd, &paths) {
                log::warn!("shelf: drag failed: {e}");
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (&app, &window, paths);
    Ok(())
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{
        IDropSource, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE,
    };
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        BHID_DataObject, ILFree, SHCreateShellItemArrayFromIDLists, SHDoDragDrop,
        SHParseDisplayName,
    };

    /// Shell drag (with the standard drag image) of files, which may live in different folders.
    pub fn drag(hwnd: isize, paths: &[String]) -> windows::core::Result<()> {
        unsafe {
            let mut pidls: Vec<*const ITEMIDLIST> = Vec::new();
            for p in paths {
                let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
                if SHParseDisplayName(&HSTRING::from(p.as_str()), None, &mut pidl, 0, None).is_ok()
                    && !pidl.is_null()
                {
                    pidls.push(pidl);
                }
            }
            let result = (|| {
                let items = SHCreateShellItemArrayFromIDLists(&pidls)?;
                let data: IDataObject = items.BindToHandler(None, &BHID_DataObject)?;
                SHDoDragDrop(
                    Some(HWND(hwnd as *mut _)),
                    &data,
                    None::<&IDropSource>,
                    DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK,
                )
                .map(|_| ())
            })();
            for p in pidls {
                ILFree(Some(p));
            }
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_of_missing_file() {
        let i = info("/definitely/not/here.txt");
        assert!(!i.exists);
        assert_eq!(i.name, "here.txt");
    }

    #[test]
    fn info_of_this_file() {
        let i = info(file!());
        assert!(i.exists && !i.is_dir && i.size > 0);
    }
}
