use tauri::WebviewWindow;

#[cfg(windows)]
pub fn monitor_bounds(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };

    let handle = window.hwnd().ok()?;
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let RECT { left, top, right, bottom } = info.rcMonitor;
        Some((left, top, right, bottom))
    }
}

#[cfg(not(windows))]
pub fn monitor_bounds(_window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(windows)]
pub fn rect(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let handle = window.hwnd().ok()?;
    let hwnd = HWND(handle.0 as *mut _);
    let mut out = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut out).ok()?;
    }
    Some((out.left, out.top, out.right - out.left, out.bottom - out.top))
}

#[cfg(not(windows))]
pub fn rect(_window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(windows)]
pub fn place(window: &WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let _ = SetWindowPos(hwnd, None, x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_NOZORDER);
    }
}

#[cfg(not(windows))]
pub fn place(_window: &WebviewWindow, _x: i32, _y: i32, _w: u32, _h: u32) {}

#[cfg(windows)]
pub fn remove_native_frame(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_USE_IMMERSIVE_DARK_MODE,
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DwmExtendFrameIntoClientArea,
        DwmSetWindowAttribute,
    };
    use windows::Win32::UI::Controls::MARGINS;

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    let dark: i32 = 1;
    let none = DWMWA_COLOR_NONE;
    let corner = DWMWCP_DONOTROUND;
    let margins = MARGINS::default();

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const _ as *const _,
            size_of::<i32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &none as *const _ as *const _,
            size_of::<u32>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner as *const _ as *const _,
            size_of::<i32>() as u32,
        );
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
}

#[cfg(not(windows))]
pub fn remove_native_frame(_window: &WebviewWindow) {}
