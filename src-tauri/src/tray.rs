//! Tray icon: the always-available way to reach settings and quit.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let version = MenuItem::with_id(
        app,
        "version",
        format!("Isle {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload island", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Isle", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &version,
            &update,
            &PredefinedMenuItem::separator(app)?,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("isle")
        .tooltip("Isle")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reload" => {
                for (label, win) in app.webview_windows() {
                    if label.starts_with("island-") {
                        let _ = win.eval("location.reload()");
                    }
                }
            }
            // The island UI owns the update flow (check → banner → install).
            "update" => {
                let _ = app.emit(crate::events::UPDATER_CHECK, ());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
