# Isle

A Dynamic Island and dock for Windows 10/11. Built with Tauri 2 (Rust) and React.

> **Status:** Phase 2 — island core + command centre, weather and system stats.
> The dock and everything else are on the [roadmap](docs/ROADMAP.md).

## What works today

- **Island pill** at the top centre of your primary monitor showing time and battery.
- **Hover to peek, click to expand**, move away or press Esc to collapse — spring animated.
- **Now playing from any app** that publishes Windows media controls (Spotify, browsers,
  Apple Music, VLC, …): artwork, title/artist, play/pause/next/previous, seek bar.
- **Audio-reactive visualiser** driven by what your speakers are actually playing.
- **Live activities**: charging and low-battery alerts take the pill briefly while music
  moves to a bubble beside it.
- **Tabs when expanded:** Home · Controls (volume, brightness, Wi-Fi, Bluetooth, Focus) ·
  Weather · System (CPU, RAM, GPU, network, disks).
- Hides itself over full-screen apps, games and videos.
- Click-through everywhere outside the island, so it never blocks your apps.
- Tray icon with *Reload island* and *Quit*.

## Run it (Windows)

Prerequisites: [Node 22+](https://nodejs.org), [Rust](https://rustup.rs) (MSVC toolchain),
and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Visual Studio
Build Tools with "Desktop development with C++"; WebView2 is already on Windows 10/11).

```powershell
git clone https://github.com/coderxpro19/isle-desktop
cd isle-desktop
npm install
npm run app:dev      # run the app with hot reload
npm run app:build    # build installers into src-tauri/target/release/bundle
```

### Design the UI in a browser

```bash
npm run dev          # http://localhost:1420
```

Runs the island over a fake desktop with mock music and battery, plus a control
panel to switch states. URL params help with screenshots:
`?mode=expanded&media=paused&charging=1&wall=1`.

## Project layout

```
src/                     React UI
  island/                island store, activities, hooks, components
  lib/                   backend interface (Tauri + mock), types, formatting
  dev/                   browser dev stage
src-tauri/src/           Rust
  island.rs              windows, placement, click-through hit testing
  media/                 Windows media sessions (win.rs) + shared logic
  audio/                 loopback capture + FFT analyzer
  power.rs settings.rs tray.rs events.rs
docs/                    ARCHITECTURE.md, ROADMAP.md
```

## Tests

```bash
npm test                          # UI logic (vitest)
cd src-tauri && cargo test        # Rust logic (analyzer, media diffing, battery decoding…)
```

CI builds and tests on `windows-latest` and uploads the installers as artifacts.

## License

MIT
