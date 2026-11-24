//! Chamadas Win32 isoladas: rect/place, remoção de frame nativo, cantos e opacidade.
use tauri::WebviewWindow;

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

#[cfg(windows)]
pub fn set_round(window: &WebviewWindow, round: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND, DwmSetWindowAttribute,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    let corner = if round { DWMWCP_ROUND } else { DWMWCP_DONOTROUND };
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner as *const _ as *const _,
            size_of::<i32>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn set_round(_window: &WebviewWindow, _round: bool) {}

#[cfg(windows)]
pub fn set_opacity(window: &WebviewWindow, alpha: u8) {
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongPtrW,
        WS_EX_LAYERED,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style & WS_EX_LAYERED.0 as isize == 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED.0 as isize);
        }
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA);
    }
}

#[cfg(not(windows))]
pub fn set_opacity(_window: &WebviewWindow, _alpha: u8) {}

#[cfg(windows)]
pub fn set_no_activate(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SetWindowLongPtrW, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // NOACTIVATE: o clique não rouba o foco. TOOLWINDOW: tiling WM (GlazeWM, komorebi)
        // e Alt+Tab ignoram a janela — sem isso o WM encaixa a bolinha na borda do tile.
        // APPWINDOW sai: força presença na barra de tarefas e anula o TOOLWINDOW.
        let keep = style & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            keep | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
        );
        // Sem SWP_FRAMECHANGED: ele refaz o frame nativo e o DWM volta a desenhar
        // a barra de título (minimizar/maximizar/fechar) por cima da bolha.
    }
}

#[cfg(not(windows))]
pub fn set_no_activate(_window: &WebviewWindow) {}

// Overlay (bolinha): sempre no topo e com região circular — o quadrado da janela
// não pinta nem captura clique; o que está fora do círculo atravessa para a janela de baixo.
#[cfg(windows)]
pub fn keep_overlay(window: &WebviewWindow, diameter: i32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SetWindowLongPtrW, SetWindowPos, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    // o frame nativo (barra de título com minimizar/maximizar/fechar) volta a aparecer
    // se o DWM for recalculado; reaplica o frame estendido a cada show
    remove_native_frame(window);
    unsafe {
        // reaplica os estilos a cada show: o tao/iTaskbarList mexe neles ao exibir
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let keep = style & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            keep | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
        );
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        // a bolha fica centralizada na janela: a região precisa acompanhar, senão
        // o círculo encosta no canto e sobra o quadrado transparente em volta
        let mut rect = windows::Win32::Foundation::RECT::default();
        let _ = windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect);
        let offset = (((rect.right - rect.left) - diameter) / 2).max(0);
        let region = CreateRoundRectRgn(
            offset,
            offset,
            offset + diameter + 1,
            offset + diameter + 1,
            diameter,
            diameter,
        );
        let _ = SetWindowRgn(hwnd, Some(region), true);
    }
}

#[cfg(not(windows))]
pub fn keep_overlay(_window: &WebviewWindow, _diameter: i32) {}

// O menu da bolinha cresce a janela: sem remover a região ele fica cortado.
#[cfg(windows)]
pub fn clear_region(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos};

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        let _ = SetWindowRgn(hwnd, None, true);
    }
}

#[cfg(not(windows))]
pub fn clear_region(_window: &WebviewWindow) {}
