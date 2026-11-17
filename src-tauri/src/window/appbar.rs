#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::Shell::{
        ABE_RIGHT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA, SHAppBarMessage,
    };

    static ACTIVE: AtomicBool = AtomicBool::new(false);

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

    pub fn reserve(window: &WebviewWindow, left: i32, top: i32, right: i32, bottom: i32) {
        let Some(hwnd) = hwnd(window) else { return };
        let band = RECT {
            left,
            top,
            right,
            bottom,
        };
        unsafe {
            if !ACTIVE.load(Ordering::Relaxed) {
                let mut new = data(hwnd);
                SHAppBarMessage(ABM_NEW, &mut new);
                ACTIVE.store(true, Ordering::Relaxed);
            }

            let mut query = data(hwnd);
            query.uEdge = ABE_RIGHT;
            query.rc = band;
            SHAppBarMessage(ABM_QUERYPOS, &mut query);
            query.rc.left = query.rc.right - (band.right - band.left);
            SHAppBarMessage(ABM_SETPOS, &mut query);
        }
    }

    pub fn release(window: &WebviewWindow) {
        if !ACTIVE.load(Ordering::Relaxed) {
            return;
        }
        if let Some(hwnd) = hwnd(window) {
            unsafe {
                let mut data = data(hwnd);
                SHAppBarMessage(ABM_REMOVE, &mut data);
            }
        }
        ACTIVE.store(false, Ordering::Relaxed);
    }
}

#[cfg(windows)]
pub use imp::{release, reserve};

#[cfg(not(windows))]
pub fn reserve(_window: &tauri::WebviewWindow, _left: i32, _top: i32, _right: i32, _bottom: i32) {}

#[cfg(not(windows))]
pub fn release(_window: &tauri::WebviewWindow) {}
