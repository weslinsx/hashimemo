//! Reserva a borda direita como AppBar e restaura a work area ao sair (multi-monitor).
#[cfg(windows)]
mod imp {
    use std::sync::Mutex;

    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
    };
    use windows::Win32::UI::Shell::{
        ABE_RIGHT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA, SHAppBarMessage,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SPI_SETWORKAREA, SPIF_SENDCHANGE, SystemParametersInfoW,
    };

    static BAND: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|handle| HWND(handle.0 as *mut _))
    }

    fn data(hwnd: HWND) -> APPBARDATA {
        APPBARDATA {
            cbSize: size_of::<APPBARDATA>() as u32,
            hWnd: hwnd,
            ..Default::default()
        }
    }

    fn restore(band: (i32, i32, i32, i32)) {
        let (left, top, right, _) = band;
        unsafe {
            let monitor = MonitorFromPoint(
                POINT {
                    x: left + 1,
                    y: top + 1,
                },
                MONITOR_DEFAULTTONEAREST,
            );
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return;
            }
            if info.rcWork.right != left {
                return;
            }
            let mut work = info.rcWork;
            work.right = right;
            let _ = SystemParametersInfoW(
                SPI_SETWORKAREA,
                0,
                Some(&mut work as *mut RECT as *mut _),
                SPIF_SENDCHANGE,
            );
        }
    }

    fn remove(hwnd: HWND) {
        unsafe {
            let mut data = data(hwnd);
            SHAppBarMessage(ABM_REMOVE, &mut data);
        }
    }

    pub fn reserve(window: &WebviewWindow, left: i32, top: i32, right: i32, bottom: i32) {
        let Some(hwnd) = hwnd(window) else { return };
        let band = (left, top, right, bottom);
        let mut previous = BAND.lock().ok().map(|mut slot| slot.replace(band)).flatten();

        unsafe {
            if previous.is_none() {
                let mut new = data(hwnd);
                SHAppBarMessage(ABM_NEW, &mut new);
            }

            let mut query = data(hwnd);
            query.uEdge = ABE_RIGHT;
            query.rc = RECT {
                left,
                top,
                right,
                bottom,
            };
            SHAppBarMessage(ABM_QUERYPOS, &mut query);
            query.rc.left = query.rc.right - (right - left);
            SHAppBarMessage(ABM_SETPOS, &mut query);
        }

        if let Some(old) = previous.take() {
            if old.2 != right || old.0 != left {
                restore(old);
            }
        }
    }

    pub fn release(window: &WebviewWindow) {
        let previous = BAND.lock().ok().and_then(|mut slot| slot.take());
        let Some(band) = previous else { return };
        if let Some(hwnd) = hwnd(window) {
            remove(hwnd);
        }
        restore(band);
    }
}

#[cfg(windows)]
pub use imp::{release, reserve};

#[cfg(not(windows))]
pub fn reserve(_window: &tauri::WebviewWindow, _left: i32, _top: i32, _right: i32, _bottom: i32) {}

#[cfg(not(windows))]
pub fn release(_window: &tauri::WebviewWindow) {}
