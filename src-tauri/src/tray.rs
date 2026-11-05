//! Tray icon: the always-available way to reach dock options, updates and quit.

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};

use crate::settings::{DockMode, SettingsStore};

struct DockItems {
    show: CheckMenuItem<Wry>,
    replace: CheckMenuItem<Wry>,
    fixed: CheckMenuItem<Wry>,
    autohide: CheckMenuItem<Wry>,
    smart: CheckMenuItem<Wry>,
}

impl DockItems {
    /// Reflect current settings in the check marks.
    fn sync(&self, app: &AppHandle) {
        let d = app.state::<SettingsStore>().get().dock;
        let _ = self.show.set_checked(d.enabled);
        let _ = self.replace.set_checked(d.replace_taskbar);
        let _ = self.replace.set_enabled(d.enabled);
        let _ = self.fixed.set_checked(d.mode == DockMode::Fixed);
        let _ = self.autohide.set_checked(d.mode == DockMode::AutoHide);
        let _ = self.smart.set_checked(d.mode == DockMode::Smart);
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let version = MenuItem::with_id(
        app,
        "version",
        format!("Isle {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;

    let items = DockItems {
        show: CheckMenuItem::with_id(app, "dock-show", "Show dock", true, true, None::<&str>)?,
        replace: CheckMenuItem::with_id(
            app,
            "dock-replace",
            "Hide Windows taskbar",
            true,
            true,
            None::<&str>,
        )?,
        fixed: CheckMenuItem::with_id(
            app,
            "dock-fixed",
            "Always visible",
            true,
            true,
            None::<&str>,
        )?,
        autohide: CheckMenuItem::with_id(
            app,
            "dock-autohide",
            "Auto-hide",
            true,
            false,
            None::<&str>,
        )?,
        smart: CheckMenuItem::with_id(
            app,
            "dock-smart",
            "Hide when windows overlap",
            true,
            false,
            None::<&str>,
        )?,
    };
    let dock_menu = Submenu::with_items(
        app,
        "Dock",
        true,
        &[
            &items.show,
            &items.replace,
            &PredefinedMenuItem::separator(app)?,
            &items.fixed,
            &items.autohide,
            &items.smart,
        ],
    )?;
    items.sync(app);

    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload Isle", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Open log folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Isle", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &version,
            &update,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &dock_menu,
            &reload,
            &logs,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("isle")
        .tooltip("Isle")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let store = app.state::<SettingsStore>();
            match event.id().as_ref() {
                "reload" => {
                    for (label, win) in app.webview_windows() {
                        if label.starts_with("island-")
                            || label.starts_with("dock-")
                            || label == "launcher"
                        {
                            let _ = win.eval("location.reload()");
                        }
                    }
                }
                // The island UI owns the update flow (check → banner → install).
                "update" => {
                    let _ = app.emit(crate::events::UPDATER_CHECK, ());
                }
                "dock-show" => store.update(app, |s| s.dock.enabled = !s.dock.enabled),
                "dock-replace" => {
                    store.update(app, |s| s.dock.replace_taskbar = !s.dock.replace_taskbar)
                }
                "dock-fixed" => store.update(app, |s| s.dock.mode = DockMode::Fixed),
                "dock-autohide" => store.update(app, |s| s.dock.mode = DockMode::AutoHide),
                "dock-smart" => store.update(app, |s| s.dock.mode = DockMode::Smart),
                "settings" => {
                    let _ = crate::settings_window::open(app, None);
                }
                "logs" => {
                    if let Ok(dir) = app.path().app_log_dir() {
                        let _ = crate::system::open_path(&dir);
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
            items.sync(app);
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
