//! Janela "bolinha" (Kami dormindo): posição persistida, snap nas bordas e restauro.
use std::{
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};

use crate::settings::{self, SettingsState};

const LABEL: &str = "bubble";
const MARGIN: i32 = 14;
const SIZE: u32 = 84;
const SNAP_DELAY_MS: u64 = 320;
const MENU_WIDTH: u32 = 188;
const MENU_HEIGHT: u32 = 158;

static PLACED: Mutex<bool> = Mutex::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static BEFORE_MENU: Mutex<Option<(i32, i32)>> = Mutex::new(None);

fn bubble(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn mark_placed() {
    if let Ok(mut placed) = PLACED.lock() {
        *placed = true;
    }
}

fn snapshot(app: &AppHandle) -> Option<settings::Settings> {
    app.try_state::<SettingsState>().map(|state| state.snapshot())
}

fn locked(app: &AppHandle) -> bool {
    snapshot(app).map(|settings| settings.bubble_locked).unwrap_or(false)
}

fn save_position(app: &AppHandle, x: i32, y: i32) {
    let Some(state) = app.try_state::<SettingsState>() else {
        return;
    };
    let mut next = state.snapshot();
    if next.bubble_x == Some(x) && next.bubble_y == Some(y) {
        return;
    }
    next.bubble_x = Some(x);
    next.bubble_y = Some(y);
    state.update(next.clone());
    settings::save(app, &next);
}

fn on_monitor(main: &WebviewWindow, monitor: &tauri::Monitor, x: i32, y: i32) -> bool {
    let _ = main;
    let position = monitor.position();
    let size = monitor.size();
    x >= position.x
        && y >= position.y
        && x + SIZE as i32 <= position.x + size.width as i32
        && y + SIZE as i32 <= position.y + size.height as i32
}

fn work_area(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((
        area.position.x,
        area.position.y,
        area.size.width as i32,
        area.size.height as i32,
    ))
}

fn eased(t: f32) -> f32 {
    let inv = 1.0 - t;
    1.0 - inv * inv * inv
}

fn slide_position(window: WebviewWindow, from: (i32, i32), to: (i32, i32)) {
    std::thread::spawn(move || {
        for step in 1..=16 {
            let t = eased(step as f32 / 16.0);
            let x = from.0 as f32 + (to.0 - from.0) as f32 * t;
            let y = from.1 as f32 + (to.1 - from.1) as f32 * t;
            let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
            std::thread::sleep(Duration::from_millis(16));
        }
        let _ = window.set_position(PhysicalPosition::new(to.0, to.1));
    });
}

fn snap(app: &AppHandle, window: &WebviewWindow) {
    if locked(app) {
        return;
    }
    let Ok(position) = window.outer_position() else {
        return;
    };
    let size = SIZE as i32;
    let Some((left, top, width, height)) = work_area(window) else {
        return;
    };
    let distances = [
        (position.x - left, (left + MARGIN, position.y)),
        (
            left + width - (position.x + size),
            (left + width - size - MARGIN, position.y),
        ),
        (position.y - top, (position.x, top + MARGIN)),
        (
            top + height - (position.y + size),
            (position.x, top + height - size - MARGIN),
        ),
    ];
    let (_, (x, y)) = distances
        .into_iter()
        .min_by_key(|(distance, _)| *distance)
        .unwrap_or((0, (position.x, position.y)));
    save_position(app, x, y);
    slide_position(window.clone(), (position.x, position.y), (x, y));
    mark_placed();
}

fn schedule_snap(app: AppHandle, window: WebviewWindow) {
    if locked(&app) {
        return;
    }
    let token = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(SNAP_DELAY_MS));
        if GENERATION.load(Ordering::SeqCst) == token {
            snap(&app, &window);
        }
    });
}

pub fn init(app: &AppHandle) {
    let Some(window) = bubble(app) else { return };
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) = event {
            if let Some(current) = handle.get_webview_window(LABEL) {
                schedule_snap(handle.clone(), current);
            }
        }
    });
}

fn default_target(main: &WebviewWindow) -> (i32, i32) {
    let monitor = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return (0, 0);
    };
    let area = monitor.work_area();
    let left = area.position.x;
    let top = area.position.y;
    let width = area.size.width as i32;
    let height = area.size.height as i32;
    let x = left + width - SIZE as i32 - MARGIN;
    let y = 185.clamp(top, top + height - SIZE as i32 - 1);
    (x, y)
}

fn snap_to_edge(window: &WebviewWindow, position: (i32, i32)) -> (i32, i32) {
    let Some((left, top, width, height)) = work_area(window) else {
        return position;
    };
    let size = SIZE as i32;
    let distances = [
        (
            (position.0 - left).abs(),
            (left + MARGIN, position.1.min(top + height - size - MARGIN).max(top + MARGIN)),
        ),
        (
            (left + width - (position.0 + size)).abs(),
            (
                left + width - size - MARGIN,
                position.1.min(top + height - size - MARGIN).max(top + MARGIN),
            ),
        ),
        (
            (position.1 - top).abs(),
            (position.0.min(left + width - size - MARGIN).max(left + MARGIN), top + MARGIN),
        ),
        (
            (top + height - (position.1 + size)).abs(),
            (
                position.0.min(left + width - size - MARGIN).max(left + MARGIN),
                top + height - size - MARGIN,
            ),
        ),
    ];
    distances
        .into_iter()
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, value)| value)
        .unwrap_or(position)
}

pub fn minimize(app: &AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("janela principal ausente")?;
    let ball = bubble(app).ok_or("bolinha ausente")?;

    crate::window::release_area(&main);

    let docked = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten());
    let stored = snapshot(app).and_then(|settings| match (settings.bubble_x, settings.bubble_y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    });
    let base = match stored {
        Some((x, y)) if docked.as_ref().is_some_and(|monitor| on_monitor(&main, monitor, x, y)) => {
            (x, y)
        }
        _ => default_target(&main),
    };
    let target = snap_to_edge(&ball, base);

    let ms = crate::window::animation_ms(app).max(220);
    // bolinha aparece já; o rail desbota em paralelo
    let _ = ball.set_size(PhysicalSize::new(SIZE, SIZE));
    let _ = ball.set_position(PhysicalPosition::new(target.0, target.1));
    save_position(app, target.0, target.1);
    mark_placed();
    let _ = ball.show();
    let _ = app.emit_to(LABEL, "bubble:show", ());

    let fade = ms.min(240);
    crate::window::fade_out(app, &main, fade);

    let _ = main.hide();
    let _ = ball.set_size(PhysicalSize::new(SIZE, SIZE));
    crate::window::reset_opacity(app);
    let _ = ball.set_position(PhysicalPosition::new(target.0, target.1));
    save_position(app, target.0, target.1);
    mark_placed();
    let _ = ball.show();
    let _ = app.emit_to(LABEL, "bubble:show", ());
    Ok(())
}

pub fn restore(app: &AppHandle) {
    let Some(ball) = bubble(app) else { return };
    let rect = ball
        .outer_position()
        .map(|position| {
            let size = ball.outer_size().map(|s| s.width).unwrap_or(SIZE);
            (position.x, position.y, size, size)
        })
        .ok();
    let _ = ball.hide();
    crate::window::show_docked(app, rect, true);
}

pub fn reset(app: &AppHandle) {
    let Some(ball) = bubble(app) else { return };
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let target = default_target(&main);
    let from = ball
        .outer_position()
        .map(|position| (position.x, position.y))
        .unwrap_or(target);
    save_position(app, target.0, target.1);
    slide_position(ball, from, target);
    mark_placed();
}

#[tauri::command]
pub fn minimize_to_bubble(app: AppHandle) -> Result<(), String> {
    minimize(&app)
}

#[tauri::command]
pub fn bubble_snap(app: AppHandle) {
    if locked(&app) {
        return;
    }
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(window) = bubble(&app) {
        snap(&app, &window);
    }
}

#[tauri::command]
pub fn bubble_restore(app: AppHandle) {
    restore(&app);
}

#[tauri::command]
pub fn bubble_reset(app: AppHandle) {
    reset(&app);
}

#[tauri::command]
pub fn bubble_position(app: AppHandle) -> Option<(i32, i32)> {
    let window = bubble(&app)?;
    window.outer_position().ok().map(|p| (p.x, p.y))
}

#[tauri::command]
pub fn bubble_move(app: AppHandle, x: i32, y: i32) {
    if let Some(window) = bubble(&app) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[tauri::command]
pub fn bubble_drag_start(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if locked(&app) {
        return Err("posiÃ§Ã£o bloqueada".into());
    }
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn bubble_locked(app: AppHandle) -> bool {
    locked(&app)
}

#[tauri::command]
pub fn bubble_toggle_lock(app: AppHandle) -> bool {
    let Some(state) = app.try_state::<SettingsState>() else {
        return false;
    };
    let mut next = state.snapshot();
    next.bubble_locked = !next.bubble_locked;
    state.update(next.clone());
    settings::save(&app, &next);
    if let Some(window) = bubble(&app) {
        if let Ok(position) = window.outer_position() {
            save_position(&app, position.x, position.y);
        }
    }
    next.bubble_locked
}

#[tauri::command]
pub fn bubble_menu_open(app: AppHandle) -> Result<(), String> {
    let window = bubble(&app).ok_or("bolinha ausente")?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let (left, top, width, height) = work_area(&window).ok_or("sem monitor")?;
    let mut x = position.x;
    let mut y = position.y;
    if position.x + SIZE as i32 > left + width / 2 {
        x = position.x - (MENU_WIDTH as i32 - SIZE as i32);
    }
    if position.y + SIZE as i32 > top + height / 2 {
        y = position.y - (MENU_HEIGHT as i32 - SIZE as i32);
    }
    if let Ok(mut slot) = BEFORE_MENU.lock() {
        *slot = Some((position.x, position.y));
    }
    let _ = window.set_size(PhysicalSize::new(MENU_WIDTH, MENU_HEIGHT));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    Ok(())
}

#[tauri::command]
pub fn bubble_menu_close(app: AppHandle) {
    let Some(window) = bubble(&app) else { return };
    let previous = BEFORE_MENU.lock().ok().and_then(|mut slot| slot.take());
    let _ = window.set_size(PhysicalSize::new(SIZE, SIZE));
    if let Some((x, y)) = previous {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

