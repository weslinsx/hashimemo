use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::notes::NotesState;

#[derive(Serialize)]
pub struct Captured {
    pub path: String,
    pub title: String,
    pub app: String,
    pub url: Option<String>,
}

#[allow(dead_code)]
pub struct Shot {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub title: String,
    pub app: String,
}

fn find_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| {
            part.trim_end_matches(|c: char| matches!(c, ')' | ']' | ',' | '.' | ';'))
                .to_string()
        })
}

#[tauri::command]
pub fn capture_window(app: AppHandle, state: State<'_, NotesState>) -> Result<Captured, String> {
    let media = state.media_dir();
    std::fs::create_dir_all(&media).map_err(|error| error.to_string())?;
    let own = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as isize)
        .unwrap_or(0);

    let shot = platform::capture(own)?;
    let path = media.join(format!("captura-{}.png", uuid::Uuid::now_v7()));
    image::save_buffer(
        &path,
        &shot.pixels,
        shot.width,
        shot.height,
        image::ColorType::Rgba8,
    )
    .map_err(|error| error.to_string())?;

    Ok(Captured {
        path: path.to_string_lossy().into_owned(),
        url: find_url(&shot.title),
        app: shot.app,
        title: shot.title,
    })
}

#[cfg(windows)]
mod platform {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH, RECT};
    use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, GetWindowDC, HGDIOBJ, ReleaseDC,
        SRCCOPY, SelectObject,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetTopWindow, GetWindow, GetWindowTextW, GetWindowThreadProcessId,
        GW_HWNDNEXT,
    };

    fn choose(own: isize) -> Result<HWND, String> {
        unsafe {
            let foreground = GetForegroundWindow();
            if !foreground.0.is_null() && foreground.0 as isize != own {
                return Ok(foreground);
            }
            let own_pid = windows::Win32::System::Threading::GetCurrentProcessId();
            let mut current = GetTopWindow(None).ok();
            while let Some(hwnd) = current {
                if hwnd.0.is_null() {
                    break;
                }
                let visible =
                    windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd).as_bool();
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                let title = title_of(hwnd);
                let mut frame = RECT::default();
                let measured = DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_EXTENDED_FRAME_BOUNDS,
                    &mut frame as *mut RECT as *mut _,
                    size_of::<RECT>() as u32,
                )
                .is_ok();
                let big = measured
                    && frame.right - frame.left >= 200
                    && frame.bottom - frame.top >= 150;
                if visible
                    && pid != own_pid
                    && big
                    && !title.is_empty()
                    && title != "Program Manager"
                {
                    return Ok(hwnd);
                }
                current = GetWindow(hwnd, GW_HWNDNEXT).ok();
            }
        }
        Err("nenhuma janela disponível para capturar".into())
    }

    pub fn capture(own: isize) -> Result<super::Shot, String> {
        unsafe {
            let hwnd = choose(own)?;
            let mut frame = RECT::default();
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut frame as *mut RECT as *mut _,
                size_of::<RECT>() as u32,
            )
            .map_err(|_| "não consegui medir a janela".to_string())?;
            let (width, height) = (frame.right - frame.left, frame.bottom - frame.top);
            if width <= 0 || height <= 0 {
                return Err("janela sem área visível".into());
            }
            let (width, height) = (width as u32, height as u32);

            let window_dc = GetWindowDC(Some(hwnd));
            let screen_dc = GetDC(None);
            let memory_dc = CreateCompatibleDC(Some(screen_dc));
            let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
            let previous = SelectObject(memory_dc, HGDIOBJ(bitmap.0));

            let copied = BitBlt(
                memory_dc,
                0,
                0,
                width as i32,
                height as i32,
                Some(window_dc),
                0,
                0,
                SRCCOPY,
            )
            .is_ok();

            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut buffer = vec![0u8; (width * height * 4) as usize];
            let lines = GetDIBits(
                memory_dc,
                bitmap,
                0,
                height,
                Some(buffer.as_mut_ptr() as *mut _),
                &mut info,
                DIB_RGB_COLORS,
            );

            SelectObject(memory_dc, previous);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            ReleaseDC(Some(hwnd), window_dc);
            ReleaseDC(None, screen_dc);

            if !copied || lines == 0 {
                return Err("não consegui capturar esta janela".into());
            }

            for pixel in buffer.chunks_exact_mut(4) {
                pixel.swap(0, 2);
                pixel[3] = 255;
            }

            Ok(super::Shot {
                width,
                height,
                pixels: buffer,
                title: title_of(hwnd),
                app: app_name(hwnd),
            })
        }
    }

    fn title_of(hwnd: HWND) -> String {
        let mut buffer = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        String::from_utf16_lossy(&buffer[..len.max(0) as usize])
            .trim()
            .to_string()
    }

    unsafe fn app_name(hwnd: HWND) -> String {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return "desconhecido".into();
        }
        unsafe {
            let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return "desconhecido".into();
            };
            let mut buffer = [0u16; MAX_PATH as usize];
            let mut size = buffer.len() as u32;
            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(buffer.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            if result.is_err() {
                return "desconhecido".into();
            }
            let path = OsString::from_wide(&buffer[..size as usize]);
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("desconhecido")
                .to_string()
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn capture(_own: isize) -> Result<super::Shot, String> {
        Err("captura disponível apenas no Windows".into())
    }
}
