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

static GENERATION: AtomicU64 = AtomicU64::new(0);
static BEFORE_MENU: Mutex<Option<(i32, i32)>> = Mutex::new(None);
static SETTLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static DRAGGING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn bubble(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
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

fn on_monitor(monitor: &tauri::Monitor, x: i32, y: i32) -> bool {
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
    if locked(app) || SETTLING.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Ok(position) = window.outer_position() else {
        return;
    };
    let size = SIZE as i32;
    // usa bounds completos do monitor: a work area pode estar encolhida pela reserva do rail
    let Some((left, top, width, height)) = area_for(window, position.x, position.y) else {
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
    // Janela de overlay: não ativa ao clicar (o primeiro clique restaura, sem roubar o foco).
    crate::window::win::set_no_activate(&window);
    crate::window::win::set_no_activate(&window);
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(_) = event {
            if DRAGGING.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
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
    // Bounds completos do monitor: a work area ainda pode estar encolhida pela reserva
    // do rail no instante do minimizar, o que colocava a bolinha 360px para dentro.
    let origin = monitor.position();
    let size = monitor.size();
    let left = origin.x;
    let top = origin.y;
    let width = size.width as i32;
    let height = size.height as i32;
    let x = left + width - SIZE as i32 - MARGIN;
    let y = (top + 185).clamp(top, top + height - SIZE as i32 - 1);
    (x, y)
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

fn snap_to_edge(window: &WebviewWindow, position: (i32, i32)) -> (i32, i32) {
    // Usa o monitor que CONTÉM o ponto desejado (o monitor do app), nunca o monitor
    // onde a bolinha estava antes — era isso que jogava a bolinha na tela errada.
    let Some((left, top, width, height)) = area_for(window, position.0, position.1) else {
        return position;
    };
    let size = SIZE as i32;
    let clamp_y = |value: i32| value.min(top + height - size - MARGIN).max(top + MARGIN);
    let clamp_x = |value: i32| value.min(left + width - size - MARGIN).max(left + MARGIN);
    let distances = [
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
    distances
        .into_iter()
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, value)| value)
        .unwrap_or(position)
}

pub fn minimize(app: &AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("janela principal ausente")?;
    let ball = bubble(app).ok_or("bolinha ausente")?;

    crate::window::remember_level(app);
    // solta a reserva primeiro: a work area encolhida fazia a bolinha nascer 360px para dentro
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
    let custom = snapshot(app).map(|settings| settings.bubble_custom).unwrap_or(false);
    let base = match stored {
        Some((x, y))
            if custom && docked.as_ref().is_some_and(|monitor| on_monitor(monitor, x, y)) =>
        {
            (x, y)
        }
        _ => default_target(&main),
    };
    let target = snap_to_edge(&ball, base);
    // Esconde o rail e SÓ DEPOIS mostra a bolinha. Sem fade: o retângulo com
    // opacidade parcial ficava visível como bloco preto.
    let _ = main.set_skip_taskbar(true);
    let _ = main.hide();
    crate::window::reset_opacity(app);

    SETTLING.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = ball.set_size(PhysicalSize::new(SIZE, SIZE));
    let _ = ball.set_position(PhysicalPosition::new(target.0, target.1));
    save_position(app, target.0, target.1);
    let _ = ball.show();
    let _ = ball.set_skip_taskbar(true);
    crate::window::win::set_no_activate(&ball);
    let _ = app.emit_to(LABEL, "bubble:show", ());
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(700));
        SETTLING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
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
    if let Ok(Some(monitor)) = ball.current_monitor() {
        crate::window::set_monitor(app, monitor.name().cloned());
    }
    let _ = ball.hide();
    let level = crate::window::previous_level(app);
    crate::window::show_level(app, level, rect);
}

pub fn reset(app: &AppHandle) {
    let Some(ball) = bubble(app) else { return };
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    // volta ao padrão do monitor: limpa a posição personalizada
    if let Some(state) = app.try_state::<SettingsState>() {
        let mut next = state.snapshot();
        next.bubble_custom = false;
        next.bubble_x = None;
        next.bubble_y = None;
        state.update(next.clone());
        settings::save(app, &next);
    }
    let target = default_target(&main);
    let from = ball
        .outer_position()
        .map(|position| (position.x, position.y))
        .unwrap_or(target);
    save_position(app, target.0, target.1);
    slide_position(ball, from, target);
}

#[tauri::command]
pub fn minimize_to_bubble(app: AppHandle) -> Result<(), String> {
    minimize(&app)
}

#[tauri::command]
pub fn bubble_snap(app: AppHandle) {
    DRAGGING.store(false, std::sync::atomic::Ordering::SeqCst);
    if locked(&app) {
        return;
    }
    if let Some(state) = app.try_state::<SettingsState>() {
        let mut next = state.snapshot();
        if !next.bubble_custom {
            next.bubble_custom = true;
            state.update(next.clone());
            settings::save(&app, &next);
        }
    }
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(window) = bubble(&app) {
        snap(&app, &window);
    }
}

#[tauri::command]
pub fn bubble_throw(app: AppHandle, vx: f64, vy: f64) {
    DRAGGING.store(false, std::sync::atomic::Ordering::SeqCst);
    if locked(&app) {
        return;
    }
    let Some(window) = bubble(&app) else { return };
    let Ok(start) = window.outer_position() else { return };
    let Some((left, top, width, height)) = area_for(&window, start.x, start.y) else {
        return;
    };

    // Inércia: projeta o arremesso com atrito e quique nas bordas do monitor.
    let size = SIZE as f64;
    let min_x = left as f64 + MARGIN as f64;
    let max_x = left as f64 + width as f64 - size - MARGIN as f64;
    let min_y = top as f64 + MARGIN as f64;
    let max_y = top as f64 + height as f64 - size - MARGIN as f64;
    let (mut x, mut y) = (start.x as f64, start.y as f64);
    let (mut dx, mut dy) = (vx.clamp(-4.0, 4.0), vy.clamp(-4.0, 4.0));
    for _ in 0..90 {
        x += dx * 16.0;
        y += dy * 16.0;
        dx *= 0.93;
        dy *= 0.93;
        if x < min_x {
            x = min_x;
            dx = -dx * 0.45;
        }
        if x > max_x {
            x = max_x;
            dx = -dx * 0.45;
        }
        if y < min_y {
            y = min_y;
            dy = -dy * 0.45;
        }
        if y > max_y {
            y = max_y;
            dy = -dy * 0.45;
        }
        if dx.abs() + dy.abs() < 0.05 {
            break;
        }
    }

    // Magnético: depois da inércia, encosta na borda mais próxima.
    let target = snap_to_edge(&window, (x.round() as i32, y.round() as i32));
    save_position(&app, target.0, target.1);
    let handle = app.clone();
    std::thread::spawn(move || {
        let steps = 18u32;
        for step in 1..=steps {
            let progress = eased(step as f32 / steps as f32);
            let nx = start.x as f32 + (target.0 - start.x) as f32 * progress;
            let ny = start.y as f32 + (target.1 - start.y) as f32 * progress;
            let _ = window.set_position(PhysicalPosition::new(nx.round() as i32, ny.round() as i32));
            std::thread::sleep(Duration::from_millis(14));
        }
        let _ = window.set_position(PhysicalPosition::new(target.0, target.1));
        let _ = handle.emit_to(LABEL, "bubble:land", ());
    });
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
    let Some(window) = bubble(&app) else { return };
    // durante o arrasto a bolinha não pode escapar do monitor atual
    let Some((left, top, width, height)) = area_for(&window, x, y) else {
        let _ = window.set_position(PhysicalPosition::new(x, y));
        return;
    };
    let size = SIZE as i32;
    let x = x.clamp(left + MARGIN, left + width - size - MARGIN);
    let y = y.clamp(top + MARGIN, top + height - size - MARGIN);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
pub fn bubble_drag_start(app: AppHandle) -> Result<(), String> {
    if locked(&app) {
        return Err("posiÃ§Ã£o bloqueada".into());
    }
    DRAGGING.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
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
    next.bubble_custom = true;
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
    let extra_x = MENU_WIDTH as i32 - SIZE as i32;
    let extra_y = MENU_HEIGHT as i32 - SIZE as i32;
    let prefer_x = if position.x - extra_x < left {
        position.x
    } else {
        position.x - extra_x
    };
    // mantém o menu na mesma altura da bolinha (centralizado verticalmente)
    let prefer_y = position.y - (extra_y / 2);
    let max_x = left + width - MENU_WIDTH as i32;
    let max_y = top + height - MENU_HEIGHT as i32;
    let x = prefer_x.clamp(left, max_x);
    let y = prefer_y.clamp(top, max_y);
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
    crate::window::win::set_no_activate(&window);
}

