//! The floating recorder: a 320×64 pill that stays on top of the call while a
//! recording runs and the main window is in the background (live.html, src/live/).
//!
//! It is made once at launch, hidden. It is shown when the main window loses focus
//! during a recording and hidden when the main window gets focus back or the
//! recording stops. Showing it never takes focus from the call: on macOS it is
//! ordered front without becoming the key window or activating Aftercall. Clicking
//! one of its buttons is an ordinary click, so macOS does make Aftercall active then.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "live";
pub const WIDTH: f64 = 320.0;
pub const HEIGHT: f64 = 64.0;
/// From the right edge and the top of the screen (below the menu bar), in points.
const MARGIN_RIGHT: f64 = 16.0;
const MARGIN_TOP: f64 = 44.0;

/// Makes the hidden window. Called once from setup.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok(w);
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("live.html".into()))
        .title("Aftercall recording")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .transparent(true)
        // macOS draws the shadow from the pill's opaque pixels; the CSS can't, in a window this size.
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
    #[cfg(target_os = "macos")]
    macos::stay_out_of_the_way(&window);
    Ok(window)
}

/// Shows the pill without taking focus, at the top right of the screen the main window is on.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    place(app, &window);
    let w = window.clone();
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        macos::order_front(&w);
        #[cfg(not(target_os = "macos"))]
        let _ = w.show();
    });
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

fn place<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let origin = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let (x, y) = top_right(origin.x, origin.y, size.width);
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// Where the pill sits on a screen whose top-left is (`left`, `top`), `width` points wide.
pub fn top_right(left: f64, top: f64, width: f64) -> (f64, f64) {
    (left + width - WIDTH - MARGIN_RIGHT, top + MARGIN_TOP)
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::{Runtime, WebviewWindow};

    // NSWindowCollectionBehavior: on every Space, beside full-screen apps (a call in
    // full screen), and left out of ⌘` window cycling.
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<*mut AnyObject> {
        window.ns_window().ok().map(|p| p.cast::<AnyObject>()).filter(|p| !p.is_null())
    }

    pub fn stay_out_of_the_way<R: Runtime>(window: &WebviewWindow<R>) {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Some(obj) = ns_window(&w) else { return };
            let behavior = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;
            // SAFETY: a live NSWindow, on the main thread; both are plain NSWindow methods.
            unsafe {
                let _: () = msg_send![obj, setCollectionBehavior: behavior];
                let _: () = msg_send![obj, setHidesOnDeactivate: false];
            }
        });
    }

    /// Brings the pill to the front without making it key or activating the app.
    pub fn order_front<R: Runtime>(window: &WebviewWindow<R>) {
        let Some(obj) = ns_window(window) else { return };
        // SAFETY: a live NSWindow, called on the main thread (see `show`).
        unsafe {
            let _: () = msg_send![obj, orderFrontRegardless];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sits_at_the_top_right_of_the_screen() {
        assert_eq!(top_right(0.0, 0.0, 1512.0), (1512.0 - 320.0 - 16.0, 44.0));
        // A second screen to the left of the main one.
        assert_eq!(top_right(-1920.0, 0.0, 1920.0), (-336.0, 44.0));
    }
}
