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
//! - `tray`     tray icon + menu
//! - `events`   names of every event emitted to the UI

mod audio;
mod connect;
mod controls;
mod events;
mod fullscreen;
mod island;
mod media;
mod power;
mod settings;
mod stats;
mod system;
mod tray;
mod util;

use tauri::Manager;

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

            let store = settings::SettingsStore::load(&handle);
            app.manage(store);

            app.manage(island::HitRegions::default());
            app.manage(power::PowerState::default());
            app.manage(media::MediaService::spawn(handle.clone()));
            app.manage(audio::Visualizer::spawn(handle.clone()));
            app.manage(controls::ControlsService::spawn(handle.clone()));
            app.manage(stats::StatsService::spawn(handle.clone()));
            app.manage(connect::ConnectService::new(handle.clone()));

            power::spawn_monitor(handle.clone());
            island::create_windows(&handle)?;
            island::spawn_hit_tester(handle.clone());
            fullscreen::spawn(handle.clone());
            tray::create(&handle)?;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Isle");
}
