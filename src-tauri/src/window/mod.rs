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
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
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

pub fn motion_duration(app: &AppHandle) -> u64 {
    motion_ms(app)
}

pub fn shrink_to(app: &AppHandle, x: i32, y: i32, w: u32, h: u32) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let state = app.state::<AppState>();
    anim::animate(
        window.clone(),
        anim::current(&window),
        Rect { x, y, w, h },
        state.generation.clone(),
        None,
        motion_ms(app),
        false,
    );
}

fn motion_ms(app: &AppHandle) -> u64 {
    app.try_state::<crate::settings::SettingsState>()
        .map(|state| state.snapshot().motion)
        .map(|motion| match motion.as_str() {
            "off" => 0,
            "fast" => 200,
            "smooth" => 480,
            "slow" => 650,
            _ => 320,
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
    let level = if docked { level } else { Level::Docked };
    let rail = docked && level == Level::Docked;
    let duration = motion_ms(app);

    if !rail {
        appbar::release(window);
    }

    let work = work_area(window, monitor.as_deref());
    let right = screen_right(window, monitor.as_deref()).unwrap_or(work.x + work.w as i32);

    let target = if docked {
        level_rect(level, work, right, width)
    } else {
        let current = anim::current(window);
        Rect {
            x: floating.map(|(x, _)| x).unwrap_or(current.x),
            y: floating.map(|(_, y)| y).unwrap_or(current.y),
            w: width,
            h: current.h.min(work.h),
        }
    };

    let band = rail.then_some((
        target.x,
        work.y,
        right,
        work.y + work.h as i32,
    ));

    let _ = window.set_always_on_top(rail);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_resizable(!docked);
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
        anim::animate(
            window.clone(),
            anim::current(window),
            target,
            state.generation.clone(),
            band,
            duration,
            !docked,
        );
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

fn settle(window: WebviewWindow, target: Rect, generation: Arc<AtomicU64>) {
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
            let _ = shown.show();
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

pub fn release_area(window: &WebviewWindow) {
    appbar::release(window);
}

pub fn show_docked(app: &AppHandle, from: Option<(i32, i32, u32, u32)>, animated: bool) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    if let Some((x, y, w, h)) = from {
        let _ = window.set_size(PhysicalSize::new(w, h));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
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
    apply(app, &window, &state, Level::Docked, true);
    if let Some(ball) = app.get_webview_window("bubble") {
        let _ = ball.hide();
    }
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
    if let Ok(mut inner) = state.inner.lock() {
        inner.monitor = target.clone();
        inner.floating = None;
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
    apply(&app, &window, &state, Level::Docked, true)
}

