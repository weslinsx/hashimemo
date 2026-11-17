use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const STEPS: u32 = 12;
const FRAME: Duration = Duration::from_millis(16);

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

fn ease_out_cubic(t: f32) -> f32 {
    let inv = 1.0 - t;
    1.0 - inv * inv * inv
}

fn lerp(a: i32, b: i32, t: f32) -> i32 {
    (a as f32 + (b - a) as f32 * t).round() as i32
}

pub fn animate(
    window: WebviewWindow,
    from: Rect,
    to: Rect,
    generation: Arc<AtomicU64>,
    band: Option<(i32, i32, i32, i32)>,
) {
    let token = generation.fetch_add(1, Ordering::SeqCst) + 1;

    thread::spawn(move || {
        for step in 1..=STEPS {
            if generation.load(Ordering::SeqCst) != token {
                return;
            }
            let t = ease_out_cubic(step as f32 / STEPS as f32);
            let x = lerp(from.x, to.x, t);
            let y = lerp(from.y, to.y, t);
            let w = lerp(from.w as i32, to.w as i32, t).max(1) as u32;
            let h = lerp(from.h as i32, to.h as i32, t).max(1) as u32;

            let _ = window.set_position(PhysicalPosition::new(x, y));
            let _ = window.set_size(PhysicalSize::new(w, h));
            thread::sleep(FRAME);
        }

        if let Some((left, top, right, bottom)) = band {
            super::appbar::reserve(&window, left, top, right, bottom);
            super::settle(window.clone(), to, generation.clone());
        }
    });
}

pub fn current(window: &WebviewWindow) -> Rect {
    let size = window
        .inner_size()
        .unwrap_or(PhysicalSize::new(360, 720));
    let pos = window
        .outer_position()
        .unwrap_or(PhysicalPosition::new(0, 0));
    Rect {
        x: pos.x,
        y: pos.y,
        w: size.width,
        h: size.height,
    }
}
