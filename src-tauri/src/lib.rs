//! Isle — Dynamic Island + dock for Windows.
//!
//! Module map (see docs/ARCHITECTURE.md):
//! - `island`   island windows, placement, cursor hit-testing
//! - `power`    battery / AC state
//! - `media`    now-playing via Windows media sessions + controls
//! - `audio`    loopback capture -> spectrum bands for the visualiser
//! - `settings` persisted user settings
//! - `connect`  Wi-Fi network list/join, Bluetooth devices/pair/connect
//! - `controls` volume, brightness, Wi-Fi, Bluetooth, network
//! - `stats`    CPU / RAM / GPU / network / disk sampling
//! - `fullscreen` hide islands over full-screen apps
//! - `system`   open Settings pages, device location
//! - `dock`     dock + Start menu (taskbar replacement)
//! - `shell`    taskbar hide/restore (crash-safe), AppBar space reservation
//! - `tray`     Isle's own tray icon + menu
//! - `tray_host` hosts other apps' tray icons for the dock
//! - `events`   names of every event emitted to the UI

mod audio;
mod autostart;
mod calendar;
mod clipboard;
mod connect;
mod controls;
mod dock;
mod events;
mod fullscreen;
mod hud;
mod island;
mod media;
mod notify;
mod power;
mod settings;
mod settings_window;
mod shelf;
mod shell;
mod stats;
mod system;
mod tray;
mod tray_host;
mod util;

use tauri::Manager;

pub use shell::run_watchdog_if_requested;

/// Lets the web UI write to Isle.log (errors, and its own startup milestones).
#[tauri::command]
fn ui_log(window: tauri::Window, level: String, message: String) {
    let label = window.label().to_string();
    match level.as_str() {
        "error" => log::error!("[{label}] {message}"),
        "warn" => log::warn!("[{label}] {message}"),
        _ => log::info!("[{label}] {message}"),
    }
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch focuses the running instance.
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            log::info!("second instance launched; ignoring");
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            log::info!("Isle {} starting", app.package_info().version);
            // A previous crash may have left the taskbar hidden.
            shell::restore_taskbar_if_needed();

            let store = settings::SettingsStore::load(&handle);
            // Keeps the Run entry pointing at the current exe after updates.
            autostart::set(store.get().general.start_with_windows);
            app.manage(store);

            app.manage(island::HitRegions::default());
            app.manage(power::PowerState::default());
            app.manage(media::MediaService::spawn(handle.clone()));
            app.manage(audio::Visualizer::spawn(handle.clone()));
            app.manage(controls::ControlsService::spawn(handle.clone()));
            app.manage(stats::StatsService::spawn(handle.clone()));
            app.manage(connect::ConnectService::new(handle.clone()));
            app.manage(dock::DockService::new());
            app.manage(tray_host::TrayHost::default());
            app.manage(notify::Notifications::spawn(handle.clone()));
            let clip_on = app
                .state::<settings::SettingsStore>()
                .get()
                .island
                .clipboard_history;
            app.manage(clipboard::ClipboardService::spawn(handle.clone(), clip_on));
            log::info!("setup: services started");

            power::spawn_monitor(handle.clone());
            island::create_windows(&handle)?;
            log::info!("setup: island window created");
            island::spawn_hit_tester(handle.clone());
            fullscreen::spawn(handle.clone());
            hud::set_enabled(
                app.state::<settings::SettingsStore>()
                    .get()
                    .island
                    .volume_hud,
            );
            hud::spawn();
            log::info!("setup: watchers started");
            // Tray first: whatever happens next, the user can quit or open the logs.
            tray::create(&handle)?;
            log::info!("setup: tray created");
            shell::taskbar::start_guards();
            log::info!("setup: taskbar guards started");
            // The dock is optional: if it fails, the island keeps working and
            // the taskbar is left alone.
            dock::ensure_default_pins(&handle);
            log::info!("setup: dock pins ready");
            match dock::create_windows(&handle) {
                Ok(()) => {
                    log::info!("setup: dock windows created");
                    dock::apply_settings(&handle);
                }
                Err(e) => log::error!("dock unavailable: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            island::island_set_hit_rects,
            island::island_ready,
            power::battery_state,
            media::media_state,
            media::media_artwork,
            media::media_control,
            audio::visualizer_set_active,
            settings::settings_get,
            settings::settings_set,
            ui_log,
            controls::controls_state,
            controls::controls_set,
            controls::controls_set_active,
            stats::stats_set_active,
            system::open_settings,
            system::location_current,
            connect::wifi_scan,
            connect::wifi_connect,
            connect::wifi_disconnect,
            connect::bt_devices,
            connect::bt_set_discovery,
            connect::bt_action,
            connect::bt_pair_respond,
            dock::dock_apps,
            dock::dock_icon,
            dock::dock_launch,
            dock::dock_window,
            dock::dock_pin,
            dock::dock_reorder,
            dock::dock_previews,
            dock::dock_places,
            dock::dock_open_place,
            dock::dock_empty_recycle_bin,
            dock::launcher_apps,
            dock::launcher_launch,
            dock::launcher_toggle,
            dock::power,
            dock::app_quit,
            tray_host::tray_icons,
            calendar::calendar_fetch,
            settings::settings_import,
            settings::settings_export,
            settings_window::isle_settings_open,
            clipboard::clip_list,
            clipboard::clip_pin,
            clipboard::clip_delete,
            clipboard::clip_copy,
            notify::notify_state,
            notify::notify_dismiss,
            notify::notify_open,
            notify::notify_settings,
            shelf::shelf_info,
            shelf::shelf_thumb,
            shelf::shelf_open,
            shelf::shelf_reveal,
            shelf::shelf_drag,
            tray_host::tray_click,
            dock::app_reload,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Isle")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Always give the user their taskbar back.
                dock::teardown(app);
            }
        });
}
