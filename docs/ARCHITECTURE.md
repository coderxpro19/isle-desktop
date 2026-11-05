# Architecture

```
┌──────────────────────────── Rust (src-tauri) ────────────────────────────┐
│ island.rs   window per monitor · placement · cursor hit-test thread      │
│ media/      GSMTC session thread (win.rs) · controls · artwork            │
│ audio/      WASAPI loopback (cpal) → analyzer.rs (FFT, 12 bands)          │
│ power.rs    battery/AC poll, emits on change only                         │
│ controls/   volume (Core Audio) · brightness (WMI/DDC) · radios · network │
│ stats.rs    sysinfo + PDH GPU, 1 Hz only while the System tab is open     │
│ fullscreen.rs  hides islands over full-screen apps                        │
│ system.rs   open Settings pages (allow-list) · device location            │
│ settings.rs JSON store in %APPDATA%\app.isle.desktop                      │
│ tray.rs     tray icon + menu                                              │
└────────────┬─────────────────────────────────────────────▲───────────────┘
   events (events.rs)                                  commands (invoke)
┌────────────▼─────────────────────────────────────────────┴───────────────┐
│ UI (src)  lib/backend.ts → backend.tauri.ts | backend.mock.ts             │
│           island/store.ts (zustand) · activities.ts · hooks.ts            │
│           island/Island.tsx · components/*                                │
└───────────────────────────────────────────────────────────────────────────┘
```

## Principles

**Every native subsystem owns a thread and talks through channels.** WinRT calls
(`.join()` on async operations) never run on the Tauri main thread or inside a
command, so a slow media app can't freeze the UI.

**Push, don't poll — and only push changes.** Media is event-driven (session
and property events) with a slow fallback timer. `media::needs_emit` drops
updates that are just natural playback progress; the UI extrapolates position
itself. Battery emits only when the displayed values change.

**The island window never resizes.** It's a fixed transparent canvas sized for
the largest state. Animations happen purely in the webview (compositor-friendly
`width/height/border-radius` springs on one element). Click-through is
controlled by `set_ignore_cursor_events`, toggled by a thread that compares the
cursor to the rectangles the UI reports. It polls at 60 Hz only when the cursor
is near an island and 10 Hz otherwise.

**Expensive work runs only while it's visible.** Audio capture starts when the
UI asks (music playing, window visible, setting on) and the stream is dropped
otherwise. Spectrum frames bypass React state: the visualiser subscribes to a
tiny bus and writes `transform: scaleY()` directly to the bars.

**The UI runs without the native app.** `backend.mock.ts` implements the same
interface with fake tracks, cover art and spectrum, plus a dev stage with
controls, so design iteration needs only `npm run dev`.

## Adding a live activity

1. Add a variant to `ActivityKind` and produce it in `deriveActivities`
   (`src/island/activities.ts`) with a priority.
2. Give it geometry in `pillSize` if it needs a non-default size.
3. Render it in `CompactContent` / `PeekContent` / `ExpandedContent`, and in `Bubble`
   for when a higher-priority activity owns the pill.
4. If it needs native data, add an event in `events.rs` + `types.ts` and a module
   in `src-tauri/src`.

## Event / command contract

| Event | Payload |
|---|---|
| `battery://changed` | `BatteryState` |
| `media://changed` | `MediaState \| null` |
| `media://artwork` | `{ key, dataUrl }` |
| `media://spectrum` | `number[12]` (0-255) |
| `island://hover` | `boolean` (window-scoped) |
| `settings://changed` | `Settings` |
| `controls://changed` | `ControlsState` |
| `stats://tick` | `StatsTick` (1 Hz while active) |

| Command | Purpose |
|---|---|
| `battery_state`, `media_state`, `media_artwork`, `settings_get` | initial snapshots |
| `media_control({ action })` | `playPause` / `next` / `previous` / `seek` |
| `visualizer_set_active({ active })` | start/stop loopback capture |
| `island_set_hit_rects({ rects })` | interactive regions for click-through |
| `island_ready` | show the window after first paint |
| `settings_set({ settings })` | persist + broadcast |
| `controls_state`, `controls_set({ action })` | read / change volume, mute, brightness, Wi-Fi, Bluetooth |
| `controls_set_active`, `stats_set_active` | demand flags: poll/sample only while visible |
| `open_settings({ page })` | open an allow-listed Windows Settings page or Task Manager |
| `location_current` | Windows location services → lat/lon |
