# Isle roadmap

Benchmark: [Bloom](https://github.com/little-systems/bloom). Goal: match it feature-for-feature, then beat it.

Legend: ✅ done · 🚧 in progress · ⬜ planned

## Phase 0 — Foundations ✅
- ✅ Tauri 2 + React 19 + TypeScript + Tailwind 4 + Motion
- ✅ Rust modules with a typed event contract (`events.rs` ⇄ `src/lib/types.ts`)
- ✅ Settings store (atomic JSON writes, forward-compatible defaults)
- ✅ Tray icon (reload / quit), single instance, file logging
- ✅ Browser dev stage with a mock backend (`npm run dev`)
- ✅ CI on `windows-latest`: typecheck, tests, fmt, clippy, installer artifacts

## Phase 1 — Island core ✅
- ✅ Transparent always-on-top island window, top-centre, DPI-aware placement
- ✅ Native cursor hit-testing: click-through everywhere except the pill/bubbles
- ✅ Compact pill: time + battery; time + artwork + visualiser while music plays
- ✅ Hover → peek, click → expand, leave/Esc → collapse; spring animations
- ✅ Music from any app via Windows media sessions (GSMTC): title/artist/album, artwork,
  play/pause/next/previous, seekable progress bar, accent colour from artwork
- ✅ Audio-reactive visualiser (WASAPI loopback → FFT → 12 bands), capture only while needed
- ✅ Live-activity system with secondary bubbles; charging + low-battery alerts as first activities

## Phase 2 — Command centre + system stats ✅
- ✅ Expanded island gets tabs: Home · Controls · Weather · System
- ✅ Volume + mute (Core Audio, live via endpoint callbacks), follows default-device changes
- ✅ Brightness: laptop panels via WMI, external monitors via DDC/CI
- ✅ Wi-Fi / Bluetooth toggles (WinRT Radios), network name + signal, ethernet/cellular aware
- ✅ Wi-Fi list in the island: scan, join (saved or with password), disconnect
- ✅ Bluetooth list in the island: connect/disconnect audio devices, pair new devices (PIN confirm), forget
- ✅ Focus mode (Isle-level: silences island alerts; shortcut to Windows Focus settings)
- ✅ CPU / RAM / GPU (PDH "GPU Engine") / network / disk with 60 s sparklines, sampled only while visible
- ✅ Weather (Open-Meteo, no key): current, high/low, rain chance, 6-hour strip; city search or device location; °C/°F
- ✅ Island hides over full-screen apps, games, videos and presentations
- ↪ System tray icons moved to Phase 3 (they live naturally in the dock)

## Phase 3 — Dock + taskbar replacement ✅
- ✅ Dock at the bottom of the primary monitor: Start, pinned apps, running apps, Downloads, Recycle Bin
- ✅ Running indicators (active app highlighted), grouping by app identity (AUMID or exe)
- ✅ Live window previews on hover (DWM thumbnails), close windows from the preview
- ✅ Right-click menus: window list, new window, pin/unpin, close all; Recycle Bin empty
- ✅ Click to launch (bounce), focus, minimise, or cycle windows
- ✅ Magnification
- ✅ Modes: always visible (reserves screen space), auto-hide (bottom-edge reveal), hide when windows overlap
- ✅ Isle Start menu: search all apps, keyboard navigation, pin from Start, power menu
- ✅ Taskbar hidden while the dock is on and **always restored**: normal quit, panic hook,
  watchdog process (crash / kill), and a marker file checked at next start; re-hidden if Explorer restarts
- ✅ Tray → Dock menu: show/hide dock, hide taskbar on/off, mode
- ✅ System tray icons in the dock: Isle hosts Shell_NotifyIcon (own `Shell_TrayWnd`, forwarded to Explorer),
  left/right/double click delivery (v4 + legacy), overflow popup; icons handed back to Explorer on quit/crash
- ⬜ Drag to reorder pins, jump lists, notification badges

## Phase 4 — Shelf, calendar, notifications, HUDs 🟨
- ✅ Volume HUD replacing the Windows flyout (media keys hooked, toggle in island menu) + brightness HUD (v0.7.0)
- ✅ Timer, stopwatch and Pomodoro as live activities with chime; Clock tab (v0.7.0)
- ✅ Calendar from ICS feeds (Google, Outlook, iCloud): month grid, upcoming list, "next event" activity (v0.7.0)
- ⬜ Notifications in the island (`UserNotificationListener`) — v0.8.0
- ⬜ File/text shelf: drop onto the island, drag back out (OLE drag-drop) — v0.8.0
- ⬜ Windows calendar accounts via WinRT `AppointmentStore`
- ⬜ Downloads and call activities

## Phase 5 — Beyond Bloom ⬜
- AI assistant: quick ask, summarise clipboard, voice; bring-your-own key (Claude, Gemini, OpenAI)
- Clipboard history with search and pinning
- Theme engine (colours, blur, radius, fonts) + theme marketplace
- Plugin/widget SDK: manifest + permissions, sandboxed iframes, typed host API
- One island per monitor
- Settings app with import/export and cloud sync
- Performance budget in CI: < 1% idle CPU, < 80 MB RAM, 60 fps+ animations
