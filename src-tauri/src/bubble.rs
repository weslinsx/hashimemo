//! Janela "bolinha" (Kami dormindo): posição persistida, snap nas bordas e retorno ao rail.
use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::settings::{self, SettingsState};
use crate::window;

const LABEL: &str = "bubble";
const MARGIN: i32 = 14;
const SIZE: u32 = 84;
const MENU_WIDTH: u32 = 188;
const MENU_HEIGHT: u32 = 158;

static BEFORE_MENU: Mutex<Option<(i32, i32)>> = Mutex::new(None);

fn bubble(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn snapshot(app: &AppHandle) -> Option<settings::Settings> {
    app.try_state::<SettingsState>().map(|state| state.snapshot())
}

fn save_position(app: &AppHandle, x: i32, y: i32) {
    let Some(state) = app.try_state::<SettingsState>() else { return };
    let mut next = state.snapshot();
    if next.bubble_x == Some(x) && next.bubble_y == Some(y) {
        return;
    }
    next.bubble_x = Some(x);
    next.bubble_y = Some(y);
    state.update(next.clone());
    settings::save(app, &next);
}

fn area_for(window: &WebviewWindow, x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    let monitors = window.available_monitors().ok()?;
    let containing = monitors.iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        x >= position.x
            && y >= position.y
            && x < position.x + size.width as i32
            && y < position.y + size.height as i32
    });
    let fallback = window.current_monitor().ok().flatten();
    let chosen = containing.or(fallback.as_ref()).or_else(|| monitors.first())?;
    let origin = chosen.position();
    let size = chosen.size();
    Some((origin.x, origin.y, size.width as i32, size.height as i32))
}

fn default_target(main: &WebviewWindow) -> (i32, i32) {
    let monitor = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return (0, 0) };
    let origin = monitor.position();
    let size = monitor.size();
    let x = origin.x + size.width as i32 - SIZE as i32 - MARGIN;
    let y = (origin.y + 185).clamp(origin.y, origin.y + size.height as i32 - SIZE as i32 - 1);
    (x, y)
}

fn snap_to_edge(window: &WebviewWindow, position: (i32, i32)) -> (i32, i32) {
    let Some((left, top, width, height)) = area_for(window, position.0, position.1) else {
        return position;
    };
    let size = SIZE as i32;
    let clamp_y = |value: i32| value.min(top + height - size - MARGIN).max(top + MARGIN);
    let clamp_x = |value: i32| value.min(left + width - size - MARGIN).max(left + MARGIN);
    let candidates = [
        ((position.0 - left).abs(), (left + MARGIN, clamp_y(position.1))),
        (
            (left + width - (position.0 + size)).abs(),
            (left + width - size - MARGIN, clamp_y(position.1)),
        ),
        ((position.1 - top).abs(), (clamp_x(position.0), top + MARGIN)),
        (
            (top + height - (position.1 + size)).abs(),
            (clamp_x(position.0), top + height - size - MARGIN),
        ),
    ];
    candidates
        .into_iter()
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, value)| value)
        .unwrap_or(position)
}

pub fn minimize(app: &AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("janela principal ausente")?;
    let ball = bubble(app).ok_or("bolinha ausente")?;

    window::release_area(&main);

    let stored = snapshot(app).and_then(|settings| match (settings.bubble_x, settings.bubble_y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    });
    let base = stored.unwrap_or_else(|| default_target(&main));
    let target = snap_to_edge(&ball, base);

    let _ = main.hide();

    let _ = ball.set_size(PhysicalSize::new(SIZE, SIZE));
    let _ = ball.set_position(PhysicalPosition::new(target.0, target.1));
    save_position(app, target.0, target.1);
    let _ = ball.show();
    Ok(())
}

pub fn restore(app: &AppHandle) {
    let Some(ball) = bubble(app) else { return };
    let rect = ball.outer_position().ok().map(|position| {
        let size = ball.outer_size().map(|s| s.width).unwrap_or(SIZE);
        (position.x, position.y, size, size)
    });
    let _ = ball.hide();
    window::show_from_bubble(app, rect);
}

pub fn reset(app: &AppHandle) {
    let Some(ball) = bubble(app) else { return };
    let Some(main) = app.get_webview_window("main") else { return };
    let target = default_target(&main);
    let _ = ball.set_size(PhysicalSize::new(SIZE, SIZE));
    let _ = ball.set_position(PhysicalPosition::new(target.0, target.1));
    save_position(app, target.0, target.1);
}

#[tauri::command]
pub fn minimize_to_bubble(app: AppHandle) -> Result<(), String> {
    minimize(&app)
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
    let _ = &app;
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn bubble_snap(app: AppHandle) {
    if let Some(window) = bubble(&app) {
        let target = window
            .outer_position()
            .map(|p| snap_to_edge(&window, (p.x, p.y)))
            .ok();
        if let Some((x, y)) = target {
            let _ = window.set_position(PhysicalPosition::new(x, y));
            save_position(&app, x, y);
        }
    }
}

#[tauri::command]
pub fn bubble_locked(app: AppHandle) -> bool {
    snapshot(&app).map(|settings| settings.bubble_locked).unwrap_or(false)
}

#[tauri::command]
pub fn bubble_menu_open(app: AppHandle) -> Result<(), String> {
    let window = bubble(&app).ok_or("bolinha ausente")?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let Some((left, top, width, height)) = area_for(&window, position.x, position.y) else {
        return Ok(());
    };
    let extra_x = MENU_WIDTH as i32 - SIZE as i32;
    let extra_y = MENU_HEIGHT as i32 - SIZE as i32;
    let prefer_x = if position.x - extra_x < left { position.x } else { position.x - extra_x };
    let prefer_y = if position.y - extra_y < top { position.y } else { position.y - extra_y };
    let x = prefer_x.clamp(left, left + width - MENU_WIDTH as i32);
    let y = prefer_y.clamp(top, top + height - MENU_HEIGHT as i32);
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
