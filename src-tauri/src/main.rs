// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `isle.exe --taskbar-watchdog <pid>` runs the crash watchdog and exits.
    isle_lib::run_watchdog_if_requested();
    isle_lib::run()
}
