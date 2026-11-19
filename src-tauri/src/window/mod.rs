//! Máquina de estados da janela: Docked (rail), Focus (70%) e Max (work area).
//! `apply` é o único ponto que move a janela; AppBar/geometria saem daqui.
//! `generation` invalida animações/settle antigos a cada mudança de nível.
mod anim;
mod appbar;
#[cfg(target_os = "linux")]
mod hypr;
mod win;

use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};

use anim::Rect;

pub const RAIL_WIDTH: u32 = 360;
const WINDOW_LABEL: &str = "main";
const WINDOW_FILE: &str = "window.json";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Level {
    #[default]
    Docked,
    Focus,
    Max,
}

#[derive(Clone, Serialize)]
pub struct WindowState {
    pub level: Level,
    pub docked: bool,
    pub hyprland: bool,
    pub monitors: usize,
}

pub struct AppState {
    inner: Mutex<Inner>,
    generation: Arc<AtomicU64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Inner {
    level: Level,
    #[serde(default)]
    previous_level: Level,
    docked: bool,
    width: u32,
    floating: Option<(i32, i32)>,
    #[serde(default)]
    monitor: Option<String>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            level: Level::Docked,
            previous_level: Level::Docked,
            docked: true,
            width: RAIL_WIDTH,
            floating: None,
            monitor: None,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

fn hyprland() -> bool {
    #[cfg(target_os = "linux")]
    {
        hypr::available()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(WINDOW_FILE))
}

fn load(app: &AppHandle) -> Inner {
    config_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, inner: &Inner) {
    let Some(path) = config_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(inner) {
        let _ = std::fs::write(path, bytes);
    }
}

fn monitors(window: &WebviewWindow) -> Vec<tauri::Monitor> {
    let mut list = window.available_monitors().unwrap_or_default();
    list.sort_by_key(|monitor| (monitor.position().x, monitor.position().y));
    list
}

fn monitor_rects(window: &WebviewWindow, name: Option<&str>) -> Option<(Rect, Rect)> {
    let list = monitors(window);
    let primary = window.primary_monitor().ok().flatten();
    let chosen = name
        .and_then(|name| list.iter().find(|monitor| monitor.name().map(|n| n.as_str()) == Some(name)))
        .or(primary.as_ref().or_else(|| list.first()))?;
    let position = chosen.position();
    let size = chosen.size();
    let area = chosen.work_area();
    Some((
        Rect {
            x: position.x,
            y: position.y,
            w: size.width,
            h: size.height,
        },
        Rect {
            x: area.position.x,
            y: area.position.y,
            w: area.size.width,
            h: area.size.height,
        },
    ))
}

fn work_area(window: &WebviewWindow, name: Option<&str>) -> Rect {
    monitor_rects(window, name).map_or(
        Rect {
            x: 0,
            y: 0,
            w: 1280,
            h: 800,
        },
        |(_, work)| work,
    )
}

fn screen_right(window: &WebviewWindow, name: Option<&str>) -> Option<i32> {
    monitor_rects(window, name).map(|(full, _)| full.x + full.w as i32)
}

fn rail_rect(right: i32, work: Rect, width: u32) -> Rect {
    let width = width.min((right - work.x).max(0) as u32);
    Rect {
        x: right - width as i32,
        y: work.y,
        w: width,
        h: work.h,
    }
}

fn centered(work: Rect, fraction: f32) -> Rect {
    let w = (work.w as f32 * fraction) as u32;
    let h = (work.h as f32 * fraction) as u32;
    Rect {
        x: work.x + ((work.w - w) / 2) as i32,
        y: work.y + ((work.h - h) / 2) as i32,
        w,
        h,
    }
}

fn level_rect(level: Level, work: Rect, right: i32, width: u32) -> Rect {
    match level {
        Level::Docked => rail_rect(right, work, width),
        Level::Focus => centered(work, 0.7),
        Level::Max => work,
    }
}

pub fn animation_ms(app: &AppHandle) -> u64 {
    motion_ms(app)
}

pub fn fade_out(_app: &AppHandle, window: &WebviewWindow, duration: u64) {
    // Síncrono de propósito: um fade em thread podia terminar depois do restore e deixar a
    // janela com alfa 0 (tela preta). Aqui ele sempre termina antes de esconder/mostrar.
    let steps = (duration / 20).max(4);
    for step in 1..=steps {
        let value = 255 - (255 * step / steps) as u8;
        win::set_opacity(window, value);
        std::thread::sleep(std::time::Duration::from_millis(duration / steps));
    }
    win::set_opacity(window, 0);
}

pub fn set_monitor(app: &AppHandle, name: Option<String>) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut inner) = state.inner.lock() {
            inner.monitor = name;
        }
    }
}

pub fn reset_opacity(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        win::set_opacity(&window, 255);
    }
}

fn motion_ms(app: &AppHandle) -> u64 {
    app.try_state::<crate::settings::SettingsState>()
        .map(|state| state.snapshot().motion)
        .map(|motion| match motion.as_str() {
            "off" => 0,
            "fast" => 240,
            "smooth" => 600,
            "slow" => 800,
            _ => 420,
        })
        .unwrap_or(320)
}

fn apply(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &AppState,
    level: Level,
    animated: bool,
) -> WindowState {
    let (docked, width, floating, monitor) = match state.inner.lock() {
        Ok(mut inner) => {
            inner.level = level;
            (inner.docked, inner.width, inner.floating, inner.monitor.clone())
        }
        Err(_) => (true, RAIL_WIDTH, None, None),
    };
    // Invalida qualquer settle pendente: um settle antigo não pode reposicionar a janela depois
    // que o nível mudou (era a causa do rail "puxar" a janela de volta ao abrir Foco/Max).
    state.generation.fetch_add(1, Ordering::SeqCst);
    let rail = docked && level == Level::Docked;
    let duration = motion_ms(app);

    if !rail {
        appbar::release(window);
        reset_work_area(window);
    }

    let work = work_area(window, monitor.as_deref());
    let right = screen_right(window, monitor.as_deref()).unwrap_or(work.x + work.w as i32);

    let target = if docked {
        level_rect(level, work, right, width)
    } else {
        match level {
            Level::Docked => {
                let current = anim::current(window);
                Rect {
                    x: floating.map(|(x, _)| x).unwrap_or(current.x),
                    y: floating.map(|(_, y)| y).unwrap_or(current.y),
                    w: width,
                    h: current.h.min(work.h),
                }
            }
            Level::Focus => centered(work, 0.7),
            Level::Max => work,
        }
    };

    let band = rail.then_some((
        target.x,
        work.y,
        right,
        work.y + work.h as i32,
    ));

    let _ = window.set_always_on_top(rail);
    let _ = window.set_skip_taskbar(docked && level == Level::Docked);
    let _ = window.set_resizable(!rail);
    win::remove_native_frame(window);
    win::set_round(window, true);

    if hyprland() {
        #[cfg(target_os = "linux")]
        {
            if docked {
                hypr::place(target);
            } else {
                hypr::release();
            }
        }
    } else if animated && duration > 0 {
        let _ = app.emit_to(WINDOW_LABEL, "window:level", ());
        dissolve_place(window, target);
        if let Some((left, top, right, bottom)) = band {
            appbar::reserve(window, left, top, right, bottom);
            settle(window.clone(), target, state.generation.clone());
        }
    } else {
        win::place(window, target.x, target.y, target.w, target.h);
        if let Some((left, top, right, bottom)) = band {
            appbar::reserve(window, left, top, right, bottom);
            settle(window.clone(), target, state.generation.clone());
        }
    }

    if let Ok(inner) = state.inner.lock() {
        save(app, &inner);
    }

    WindowState {
        level,
        docked,
        hyprland: hyprland(),
        monitors: monitors(window).len(),
    }
}



fn dissolve_place(window: &WebviewWindow, target: Rect) {
    // Troca de forma sem animar tamanho de janela (que engasga no WebView):
    // desbota -> aplica a geometria final -> volta a opacidade. Parece um morph suave.
    for step in 1..=4 {
        win::set_opacity(window, 255 - (255 * step / 4) as u8);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    win::place(window, target.x, target.y, target.w, target.h);
    for step in 0..=6 {
        win::set_opacity(window, (255 * step / 6) as u8);
        std::thread::sleep(std::time::Duration::from_millis(28));
    }
    win::set_opacity(window, 255);
}

fn settle(window: WebviewWindow, target: Rect, generation: Arc<AtomicU64>) {
    // Reaplica a geometria por ~2s apenas para o rail, porque o shell pode ajustar a janela
    // depois da reserva de AppBar. Qualquer novo `apply` incrementa a geração e encerra este loop.
    let token = generation.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        for _ in 0..22 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if generation.load(Ordering::SeqCst) != token {
                return;
            }
            let ok = win::rect(&window).is_some_and(|(x, y, w, h)| {
                x == target.x && y == target.y && w as u32 == target.w && h as u32 == target.h
            });
            if !ok {
                win::place(&window, target.x, target.y, target.w, target.h);
            }
        }
    });
}

pub fn watch_monitors(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
                return;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let state = app.state::<AppState>();
            let (docked, monitor) = state
                .inner
                .lock()
                .map(|inner| (inner.docked && inner.level == Level::Docked, inner.monitor.clone()))
                .unwrap_or((false, None));
            if !docked {
                continue;
            }
            let (Some(full), Some((x, y, w, h))) =
                (monitor_rects(&window, monitor.as_deref()).map(|(full, _)| full), win::rect(&window))
            else {
                continue;
            };
            let (left, top) = (full.x, full.y);
            let (right, bottom) = (full.x + full.w as i32, full.y + full.h as i32);
            if x < left || y < top || x + w > right || y + h > bottom {
                apply(&app, &window, &state, Level::Docked, false);
            }
        }
    });
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return Ok(());
    };

    let state = app.state::<AppState>();
    if let Ok(mut inner) = state.inner.lock() {
        *inner = load(app);
    }

    let _ = window.set_decorations(false);
    win::remove_native_frame(&window);

    apply(app, &window, &state, Level::Docked, false);

    {
        let shown = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(900));
            win::set_opacity(&shown, 0);
            let _ = shown.show();
            for step in 1..=8 {
                win::set_opacity(&shown, (255 * step / 8) as u8);
                std::thread::sleep(std::time::Duration::from_millis(32));
            }
            win::set_opacity(&shown, 255);
        });
    }

    let handle = app.clone();

    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Some(window) = handle.get_webview_window(WINDOW_LABEL) {
                appbar::release(&window);
                let _ = window.hide();
            }
        }
        WindowEvent::Moved(position) => {
            let state = handle.state::<AppState>();
            if let Ok(mut inner) = state.inner.lock() {
                if !inner.docked {
                    inner.floating = Some((position.x, position.y));
                    save(&handle, &inner);
                }
            }
        }
        _ => {}
    });

    Ok(())
}

#[cfg(windows)]
pub fn reset_work_area(window: &WebviewWindow) {
    // Se sobrou reserva de AppBar (work area menor que o monitor), devolve a faixa.
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SPI_SETWORKAREA, SPIF_SENDCHANGE, SystemParametersInfoW,
    };
    appbar::clear(window);
    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as *mut _);
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return;
        }
        if info.rcWork.right >= info.rcMonitor.right {
            return;
        }
        let mut work = info.rcWork;
        work.right = info.rcMonitor.right;
        let _ = SystemParametersInfoW(
            SPI_SETWORKAREA,
            0,
            Some(&mut work as *mut RECT as *mut _),
            SPIF_SENDCHANGE,
        );
    }
}

#[cfg(not(windows))]
pub fn reset_work_area(_window: &WebviewWindow) {}

pub fn release_area(window: &WebviewWindow) {
    appbar::release(window);
}

pub fn remember_level(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut inner) = state.inner.lock() {
            inner.previous_level = inner.level;
        }
    }
}

pub fn previous_level(app: &AppHandle) -> Level {
    app.try_state::<AppState>()
        .and_then(|state| state.inner.lock().ok().map(|inner| inner.previous_level))
        .unwrap_or(Level::Docked)
}

pub fn show_level(app: &AppHandle, level: Level, from: Option<(i32, i32, u32, u32)>) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    win::set_opacity(&window, 255);
    if let Some((x, y, w, h)) = from {
        let _ = window.set_size(PhysicalSize::new(w.max(200), h.max(120)));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = app.emit_to(WINDOW_LABEL, "app:expand", ());
    let _ = window.show();
    let state = app.state::<AppState>();
    if let Ok(mut inner) = state.inner.lock() {
        inner.docked = true;
    }
    apply(app, &window, &state, level, true);
    let _ = window.set_focus();
}

pub fn show_docked(app: &AppHandle, from: Option<(i32, i32, u32, u32)>, animated: bool) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    win::set_opacity(&window, 255);
    if let Some((x, y, w, h)) = from {
        let _ = window.set_size(PhysicalSize::new(w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = app.emit_to(WINDOW_LABEL, "app:expand", ());
    let _ = window.show();
    let state = app.state::<AppState>();
    if let Ok(mut inner) = state.inner.lock() {
        inner.docked = true;
    }
    apply(app, &window, &state, Level::Docked, animated);
    let _ = window.set_focus();
}

pub fn reapply(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let state = app.state::<AppState>();
    let level = state
        .inner
        .lock()
        .map(|inner| inner.level)
        .unwrap_or(Level::Docked);
    apply(app, &window, &state, level, false);
}

#[tauri::command]
pub fn toggle_focus_height(
    _app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> WindowState {
    let Some((x, _, w, h)) = win::rect(&window) else {
        return snapshot(&window, &state);
    };
    let monitor = state.inner.lock().ok().and_then(|inner| inner.monitor.clone());
    let work = work_area(&window, monitor.as_deref());
    let full = h > 0 && (h as f32) > work.h as f32 * 0.85;
    let target_h = if full {
        (work.h as f32 * 0.7) as u32
    } else {
        work.h
    };
    let y = work.y + ((work.h as i32 - target_h as i32) / 2).max(0);
    win::place(&window, x, y, w.max(1) as u32, target_h.max(120));
    snapshot(&window, &state)
}

pub fn reset_windows(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let state = app.state::<AppState>();
    if let Ok(mut inner) = state.inner.lock() {
        inner.docked = true;
        inner.floating = None;
        inner.monitor = None;
    }
    win::set_opacity(&window, 255);
    let _ = window.show();
    apply(app, &window, &state, Level::Docked, true);
    if let Some(ball) = app.get_webview_window("bubble") {
        let _ = ball.hide();
    }
    let _ = window.set_focus();
}

fn snapshot(window: &WebviewWindow, state: &AppState) -> WindowState {
    let (level, docked) = state
        .inner
        .lock()
        .map(|inner| (inner.level, inner.docked))
        .unwrap_or((Level::Docked, true));
    WindowState {
        level: if docked { level } else { Level::Docked },
        docked,
        hyprland: hyprland(),
        monitors: monitors(window).len(),
    }
}

#[tauri::command]
pub fn window_state(window: WebviewWindow, state: State<'_, AppState>) -> WindowState {
    snapshot(&window, &state)
}

#[tauri::command]
pub fn cycle_monitor(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> WindowState {
    let list = monitors(&window);
    if list.len() < 2 {
        return snapshot(&window, &state);
    }
    let (level, current) = match state.inner.lock() {
        Ok(inner) => (inner.level, inner.monitor.clone()),
        Err(_) => return snapshot(&window, &state),
    };
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    let index = current
        .or(primary)
        .and_then(|name| {
            list.iter()
                .position(|monitor| monitor.name().map(|n| n.as_str()) == Some(name.as_str()))
        })
        .unwrap_or(0);
    let next = &list[(index + 1) % list.len()];
    let target = next.name().cloned();
    let monitor_area = monitor_rects(&window, target.as_deref()).map(|(_, work)| work);
    if let Ok(mut inner) = state.inner.lock() {
        inner.monitor = target.clone();
        if inner.docked {
            inner.floating = None;
        } else if let Some(work) = monitor_area {
            let height = win::rect(&window)
                .map(|(_, _, _, h)| h.max(1) as u32)
                .unwrap_or(work.h)
                .min(work.h);
            inner.floating = Some((
                work.x + ((work.w as i32 - inner.width as i32) / 2).max(0),
                work.y + ((work.h as i32 - height as i32) / 2).max(0),
            ));
        }
    }
    apply(&app, &window, &state, level, true)
}

#[tauri::command]
pub fn set_level(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    level: Level,
) -> WindowState {
    apply(&app, &window, &state, level, true)
}

#[tauri::command]
pub fn toggle_dock(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> WindowState {
    if let Ok(mut inner) = state.inner.lock() {
        inner.docked = !inner.docked;
        if !inner.docked {
            if let Some((x, y)) = inner.floating {
                let inside = monitor_rects(&window, inner.monitor.as_deref())
                    .map(|(full, _)| {
                        x >= full.x
                            && y >= full.y
                            && x + inner.width as i32 <= full.x + full.w as i32
                            && y + 240 <= full.y + full.h as i32
                    })
                    .unwrap_or(false);
                if !inside {
                    inner.floating = None;
                }
            }
        }
    }
    apply(&app, &window, &state, Level::Docked, true);
    if !state.inner.lock().map(|inner| inner.docked).unwrap_or(true) {
        let _ = window.set_focus();
    }
    snapshot(&window, &state)
}

