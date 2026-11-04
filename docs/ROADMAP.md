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

## Phase 2 — Command centre + system stats ⬜
- Volume (Core Audio endpoint), per-app volume, output device switcher
- Brightness (WMI for laptop panels, DDC/CI for external monitors)
- Wi-Fi / Bluetooth / airplane toggles (WinRT `Radio` APIs), network name
- Focus mode (Windows Focus Assist / Do Not Disturb)
- System tray icons inside the island
- CPU / RAM / GPU / network / disk (sampled in Rust, 1 Hz only while the panel is open)
- Weather (Open-Meteo, no API key) with location from settings
- Hide island automatically over full-screen apps/games

## Phase 3 — Dock + taskbar replacement ⬜
- AppBar registration so maximised windows respect the dock
- Hide `Shell_TrayWnd` (+ secondary taskbars) with a watchdog process and panic hook that
  **always** restore the taskbar on quit, crash, or kill
- Pinned apps, running indicators, multi-window grouping (WinEventHook)
- Live DWM thumbnail previews on hover, right-click menus + jump lists
- Fixed / auto-hide / smart-hide, magnification, drives, folders, Recycle Bin
- Custom Start menu (search, pinned, recent)

## Phase 4 — Shelf, calendar, notifications, HUDs ⬜
- File/text shelf: drop onto the island, drag back out (OLE drag-drop)
- Calendar (Windows calendar via WinRT + ICS feeds), timer / stopwatch / pomodoro activities
- Notifications in the island (`UserNotificationListener`)
- Volume/brightness HUD replacing the Windows flyout
- Downloads and call activities

## Phase 5 — Beyond Bloom ⬜
- AI assistant: quick ask, summarise clipboard, voice; bring-your-own key (Claude, Gemini, OpenAI)
- Clipboard history with search and pinning
- Theme engine (colours, blur, radius, fonts) + theme marketplace
- Plugin/widget SDK: manifest + permissions, sandboxed iframes, typed host API
- One island per monitor
- Settings app with import/export and cloud sync
- Performance budget in CI: < 1% idle CPU, < 80 MB RAM, 60 fps+ animations
