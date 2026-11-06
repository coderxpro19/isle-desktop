//! Screen-edge overlays: the volume HUD (left edge), the brightness HUD (right
//! edge) and the rounded top screen corners. All are transparent, always-on-top
//! windows; the HUDs are click-through except where the UI reports hit rects
//! (a thin strip at the edge, or the visible slider).

use tauri::{
    AppHandle, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

/// Logical size of each edge HUD window.
pub const EDGE_W: f64 = 76.0;
pub const EDGE_H: f64 = 320.0;
/// Logical height of the corners strip.
pub const CORNERS_H: f64 = 24.0;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Side {
    Left,
    Right,
}

/// Physical position of an edge window, vertically centred on the monitor.
pub fn edge_pos(
    mon_x: f64,
    mon_y: f64,
    mon_w: f64,
    mon_h: f64,
    scale: f64,
    side: Side,
) -> (i32, i32) {
    let w = EDGE_W * scale;
    let h = EDGE_H * scale;
    let x = match side {
        Side::Left => mon_x,
        Side::Right => mon_x + mon_w - w,
    };
    (x.round() as i32, (mon_y + (mon_h - h) / 2.0).round() as i32)
}

fn base(app: &AppHandle, label: &str, w: f64, h: f64) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Isle")
        .inner_size(w, h)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .build()
}

fn place(win: &WebviewWindow, m: &Monitor, side: Option<Side>) {
    let scale = m.scale_factor();
    let (mx, my) = (m.position().x as f64, m.position().y as f64);
    let (mw, mh) = (m.size().width as f64, m.size().height as f64);
    let (pos, size) = match side {
        Some(side) => (
            edge_pos(mx, my, mw, mh, scale, side),
            PhysicalSize::new(
                (EDGE_W * scale).round() as u32,
                (EDGE_H * scale).round() as u32,
            ),
        ),
        None => (
            (mx as i32, my as i32),
            PhysicalSize::new(mw as u32, (CORNERS_H * scale).round() as u32),
        ),
    };
    let _ = win.set_size(size);
    let _ = win.set_position(PhysicalPosition::new(pos.0, pos.1));
}

pub fn create_windows(app: &AppHandle) -> tauri::Result<()> {
    let Some(m) = app.primary_monitor()?.or_else(|| {
        app.available_monitors()
            .ok()
            .and_then(|m| m.into_iter().next())
    }) else {
        return Ok(());
    };
    // The UI routes by window label (query strings don't resolve as assets).
    let windows = [
        ("edge-l-0", Some(Side::Left)),
        ("edge-r-0", Some(Side::Right)),
        ("corners-0", None),
    ];
    for (label, side) in windows {
        let (w, h) = if side.is_some() {
            (EDGE_W, EDGE_H)
        } else {
            (m.size().width as f64 / m.scale_factor(), CORNERS_H)
        };
        let win = base(app, label, w, h)?;
        place(&win, &m, side);
        let w2 = win.clone();
        win.on_window_event(move |e| {
            if let WindowEvent::ScaleFactorChanged { .. } = e {
                if let Ok(Some(m)) = w2.current_monitor() {
                    place(&w2, &m, side);
                }
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_hug_monitor_sides() {
        // 1920×1080 at 125%: window is 95×400 physical.
        assert_eq!(
            edge_pos(0.0, 0.0, 1920.0, 1080.0, 1.25, Side::Left),
            (0, 340)
        );
        assert_eq!(
            edge_pos(0.0, 0.0, 1920.0, 1080.0, 1.25, Side::Right),
            (1825, 340)
        );
        // Secondary monitor to the right.
        assert_eq!(
            edge_pos(1920.0, 0.0, 2560.0, 1440.0, 1.0, Side::Right).0,
            1920 + 2560 - 76
        );
    }
}
