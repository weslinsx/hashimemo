mod store;

pub use store::{Note, Store};

use std::{
    sync::Mutex,
    time::Duration,
};

use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct NotesState {
    store: Mutex<Store>,
}

impl NotesState {
    pub fn media_dir(&self) -> std::path::PathBuf {
        self.store
            .lock()
            .map(|store| store.media_dir())
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
    }
}

fn watcher(app: &AppHandle, store: &Store) -> notify::Result<()> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        None,
        move |result: DebounceEventResult| {
            if result.is_ok() {
                let _ = handle.emit("notes:changed", ());
            }
        },
    )?;

    debouncer.watch(&store.notes_dir(), notify::RecursiveMode::NonRecursive)?;
    Box::leak(Box::new(debouncer));
    Ok(())
}

fn attach(app: &AppHandle, store: Store) {
    let _ = store.ensure();
    let _ = watcher(app, &store);
    if let Some(state) = app.try_state::<NotesState>() {
        if let Ok(mut slot) = state.store.lock() {
            *slot = store;
        }
    } else {
        app.manage(NotesState {
            store: Mutex::new(store),
        });
    }
    let _ = app.emit("notes:changed", ());
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let settings = crate::settings::load(app);
    attach(app, Store::with_notes(settings.notes_root));
    Ok(())
}

pub fn reconfigure(app: &AppHandle, settings: &crate::settings::Settings) {
    attach(app, Store::with_notes(settings.notes_root.clone()));
}

fn with_store<T>(state: &State<'_, NotesState>, run: impl FnOnce(&Store) -> T) -> Result<T, String> {
    state
        .store
        .lock()
        .map(|store| run(&store))
        .map_err(|_| "store unavailable".to_string())
}

#[tauri::command]
pub fn notes_dir(state: State<'_, NotesState>) -> String {
    with_store(&state, |store| store.notes_dir().to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_notes(state: State<'_, NotesState>) -> Vec<Note> {
    with_store(&state, |store| store.list()).unwrap_or_default()
}

#[tauri::command]
pub fn fetch_note(state: State<'_, NotesState>, needle: String) -> Option<Note> {
    with_store(&state, |store| store.fetch(&needle)).ok().flatten()
}

#[tauri::command]
pub fn create_note(
    state: State<'_, NotesState>,
    title: Option<String>,
    body: Option<String>,
    color: Option<String>,
    group: Option<String>,
) -> Result<Note, String> {
    with_store(&state, |store| {
        store.create(
            title.as_deref().unwrap_or_default(),
            body.as_deref().unwrap_or_default(),
            color.as_deref().unwrap_or("mauve"),
            group.as_deref().unwrap_or_default(),
        )
    })?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_note(state: State<'_, NotesState>, note: Note) -> Result<Note, String> {
    with_store(&state, |store| store.save(note))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_note(state: State<'_, NotesState>, id: String) -> Result<(), String> {
    with_store(&state, |store| {
        let note = store.fetch(&id).ok_or("not found")?;
        store.delete(&note).map_err(|error| error.to_string())
    })?
}

#[tauri::command]
pub fn search_notes(state: State<'_, NotesState>, query: String) -> Vec<Note> {
    with_store(&state, |store| store.search(&query)).unwrap_or_default()
}
