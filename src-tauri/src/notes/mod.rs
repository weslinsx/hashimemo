mod store;

pub use store::{Note, Store};

use std::{
    sync::Mutex,
    time::Duration,
};

use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::secure::{self, Vault};

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

    pub fn reencrypt_all(&self, old: &[u8; 32], new: &[u8; 32]) -> Result<usize, String> {
        let store = self.store.lock().map_err(|_| "store indisponível".to_string())?;
        let mut count = 0;
        for mut note in store.list().into_iter().filter(|note| note.protected) {
            let title = secure::decrypt(old, &note.secret_title).ok_or("PIN incorreto")?;
            let body = secure::decrypt(old, &note.secret_body).ok_or("PIN incorreto")?;
            note.secret_title = secure::encrypt(new, &title).ok_or("falha ao cifrar")?;
            note.secret_body = secure::encrypt(new, &body).ok_or("falha ao cifrar")?;
            let _ = store.save(note);
            count += 1;
        }
        Ok(count)
    }

    pub fn release_all(&self, key: &[u8; 32]) -> Result<usize, String> {
        let store = self.store.lock().map_err(|_| "store indisponível".to_string())?;
        let mut count = 0;
        for mut note in store.list().into_iter().filter(|note| note.protected) {
            let title = secure::decrypt(key, &note.secret_title).ok_or("PIN incorreto")?;
            let body = secure::decrypt(key, &note.secret_body).ok_or("PIN incorreto")?;
            note.title = title;
            note.body = body;
            note.protected = false;
            note.hidden = false;
            note.secret_title.clear();
            note.secret_body.clear();
            let _ = store.save(note);
            count += 1;
        }
        Ok(count)
    }

    pub fn wipe_protected(&self) -> usize {
        let Ok(store) = self.store.lock() else {
            return 0;
        };
        let mut count = 0;
        for note in store.list().into_iter().filter(|note| note.protected) {
            if store.delete(&note).is_ok() {
                count += 1;
            }
        }
        count
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

fn due_reminders(app: &AppHandle) {
    let Some(state) = app.try_state::<NotesState>() else {
        return;
    };
    let now = OffsetDateTime::now_utc();
    let due: Vec<Note> = match state.store.lock() {
        Ok(store) => store
            .list()
            .into_iter()
            .filter(|note| {
                OffsetDateTime::parse(&note.remind_at, &Rfc3339)
                    .map(|when| when <= now)
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return,
    };
    if due.is_empty() {
        return;
    }

    for mut note in due {
        let preview: String = note.body.lines().next().unwrap_or("").chars().take(120).collect();
        let _ = app
            .notification()
            .builder()
            .title(if note.title.is_empty() {
                "HashiMemo".to_string()
            } else {
                note.title.clone()
            })
            .body(if preview.is_empty() {
                "Lembrete".to_string()
            } else {
                preview
            })
            .show();
        note.remind_at = String::new();
        if let Ok(store) = state.store.lock() {
            let _ = store.save(note);
        }
    }
    let _ = app.emit("notes:changed", ());
}

pub fn start_reminders(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        loop {
            due_reminders(&app);
            std::thread::sleep(Duration::from_secs(20));
        }
    });
}

fn with_store<T>(state: &State<'_, NotesState>, run: impl FnOnce(&Store) -> T) -> Result<T, String> {
    state
        .store
        .lock()
        .map(|store| run(&store))
        .map_err(|_| "store unavailable".to_string())
}

fn reveal(note: &mut Note, vault: &Vault) {
    if !note.protected {
        return;
    }
    match vault.key() {
        Some(key) => {
            note.title = secure::decrypt(&key, &note.secret_title).unwrap_or_default();
            note.body = secure::decrypt(&key, &note.secret_body).unwrap_or_default();
        }
        None => {
            note.title.clear();
            note.body.clear();
        }
    }
}

fn conceal(note: &mut Note, key: &[u8; 32]) -> Result<(), String> {
    let title = secure::encrypt(key, &note.title).ok_or("falha ao cifrar o título")?;
    let body = secure::encrypt(key, &note.body).ok_or("falha ao cifrar o corpo")?;
    note.secret_title = title;
    note.secret_body = body;
    note.title.clear();
    note.body.clear();
    Ok(())
}

#[tauri::command]
pub fn notes_dir(state: State<'_, NotesState>) -> String {
    with_store(&state, |store| store.notes_dir().to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub fn list_notes(state: State<'_, NotesState>, vault: State<'_, Vault>) -> Vec<Note> {
    with_store(&state, |store| {
        let mut notes = store.list();
        for note in &mut notes {
            reveal(note, &vault);
        }
        notes
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn fetch_note(
    state: State<'_, NotesState>,
    vault: State<'_, Vault>,
    needle: String,
) -> Option<Note> {
    with_store(&state, |store| store.fetch(&needle))
        .ok()
        .flatten()
        .map(|mut note| {
            reveal(&mut note, &vault);
            note
        })
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
pub fn update_note(
    state: State<'_, NotesState>,
    vault: State<'_, Vault>,
    mut note: Note,
) -> Result<Note, String> {
    if note.protected {
        let key = vault.key().ok_or("pin")?;
        conceal(&mut note, &key)?;
    }
    let saved = with_store(&state, |store| store.save(note))?.map_err(|error| error.to_string())?;
    let mut saved = saved;
    reveal(&mut saved, &vault);
    Ok(saved)
}

#[tauri::command]
pub fn set_protected(
    state: State<'_, NotesState>,
    vault: State<'_, Vault>,
    id: String,
    protected: bool,
) -> Result<(), String> {
    let mut note = with_store(&state, |store| store.fetch(&id))?
        .ok_or("nota não encontrada")?;
    let plain = note.title.clone();
    if protected {
        let key = vault.key().ok_or("pin")?;
        note.protected = true;
        note.hidden = true;
        conceal(&mut note, &key)?;
    } else {
        note.hidden = false;
    }
    let saved = with_store(&state, |store| store.save(note))?.map_err(|error| error.to_string())?;
    if protected && !plain.is_empty() {
        let content = std::fs::read_to_string(&saved.path).map_err(|error| error.to_string())?;
        if content.contains(&plain) {
            return Err("a nota não foi cifrada".into());
        }
    }
    Ok(())
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

#[tauri::command]
pub fn open_notes_dir(app: AppHandle, state: State<'_, NotesState>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = state
        .store
        .lock()
        .map(|store| store.notes_dir())
        .map_err(|_| "store indisponível".to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_pasted_image(state: State<'_, NotesState>, data: String) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    let bytes = STANDARD.decode(data).map_err(|_| "imagem inválida")?;
    let ext = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        "png"
    };
    let dir = state.media_dir();
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("colado-{}.{ext}", uuid::Uuid::now_v7()));
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
