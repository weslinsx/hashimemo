use std::{
    path::PathBuf,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

const SETTINGS_FILE: &str = "settings.json";
const MIN_SCALE: u16 = 80;
const MAX_SCALE: u16 = 160;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub font_scale: u16,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            font_scale: 100,
            autostart: true,
        }
    }
}

impl Settings {
    fn normalized(mut self) -> Self {
        self.font_scale = self.font_scale.clamp(MIN_SCALE, MAX_SCALE);
        self
    }
}

pub struct SettingsState {
    inner: Mutex<Settings>,
}

impl SettingsState {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            inner: Mutex::new(load(app)),
        }
    }

    pub fn snapshot(&self) -> Settings {
        self.inner
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(SETTINGS_FILE))
}

pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
        .unwrap_or_default()
        .normalized()
}

fn save(app: &AppHandle, settings: &Settings) {
    let Some(path) = path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(settings) {
        let _ = std::fs::write(path, bytes);
    }
}

pub fn apply_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let _ = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Settings {
    state.snapshot()
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    settings: Settings,
) -> Settings {
    let settings = settings.normalized();
    if let Ok(mut inner) = state.inner.lock() {
        *inner = settings.clone();
    }
    save(&app, &settings);
    apply_autostart(&app, settings.autostart);
    settings
}
