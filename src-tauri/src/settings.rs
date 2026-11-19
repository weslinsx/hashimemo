//! Preferências persistidas em settings.json (tema, motion, autosave, cofre, bolinha).
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
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub notes_root: Option<String>,
    #[serde(default = "default_motion")]
    pub motion: String,
    #[serde(default = "default_autosave")]
    pub autosave: bool,
    #[serde(default = "default_minimize")]
    pub minimize_mode: String,
    #[serde(default)]
    pub pin_salt: Option<String>,
    #[serde(default)]
    pub pin_check: Option<String>,
    #[serde(default)]
    pub pin_fails: u32,
    #[serde(default)]
    pub pin_last: Option<String>,
    #[serde(default)]
    pub bubble_x: Option<i32>,
    #[serde(default)]
    pub bubble_y: Option<i32>,
    #[serde(default)]
    pub bubble_locked: bool,
    #[serde(default)]
    pub bubble_custom: bool,
}

fn default_autosave() -> bool {
    true
}

fn default_minimize() -> String {
    "bubble".into()
}

fn default_theme() -> String {
    "mocha".into()
}

fn default_motion() -> String {
    "fluid".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            font_scale: 100,
            autostart: true,
            theme: default_theme(),
            notes_root: None,
            motion: default_motion(),
            autosave: true,
            minimize_mode: default_minimize(),
            pin_salt: None,
            pin_check: None,
            pin_fails: 0,
            pin_last: None,
            bubble_x: None,
            bubble_y: None,
            bubble_locked: false,
            bubble_custom: false,
        }
    }
}

const THEMES: [&str; 3] = ["mocha", "latte", "breeze"];
const MOTIONS: [&str; 5] = ["off", "fast", "fluid", "smooth", "slow"];

impl Settings {
    fn normalized(mut self) -> Self {
        self.font_scale = self.font_scale.clamp(MIN_SCALE, MAX_SCALE);
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = default_theme();
        }
        if !MOTIONS.contains(&self.motion.as_str()) {
            self.motion = default_motion();
        }
        if self.minimize_mode != "hide" {
            self.minimize_mode = default_minimize();
        }
        self.notes_root = self
            .notes_root
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty());
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

    pub fn update(&self, settings: Settings) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = settings;
        }
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

pub(crate) fn save(app: &AppHandle, settings: &Settings) {
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
    let previous = state.snapshot();
    let mut settings = settings;
    settings.pin_salt = previous.pin_salt.clone();
    settings.pin_check = previous.pin_check.clone();
    settings.pin_fails = previous.pin_fails;
    settings.pin_last = previous.pin_last.clone();
    settings.bubble_x = previous.bubble_x;
    settings.bubble_y = previous.bubble_y;
    settings.bubble_locked = previous.bubble_locked;
    settings.bubble_custom = previous.bubble_custom;
    if let Ok(mut inner) = state.inner.lock() {
        *inner = settings.clone();
    }
    save(&app, &settings);
    apply_autostart(&app, settings.autostart);
    if previous.notes_root != settings.notes_root {
        crate::notes::reconfigure(&app, &settings);
    }
    settings
}
