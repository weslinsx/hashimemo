//! Utilitários de geometria (Rect/current). A animação visível das trocas de nível é CSS.
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
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
