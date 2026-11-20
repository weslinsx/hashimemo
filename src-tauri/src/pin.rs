//! Comandos do PIN: criar, desbloquear, travar, trocar e remover (4 erros apagam).
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::{
    notes::NotesState,
    secure::{self, Vault},
    settings::{self, SettingsState},
};

const MAX_FAILS: u32 = 4;
const FAIL_WINDOW_SECS: i64 = 30;

#[derive(Serialize, Clone)]
pub struct PinStatus {
    pub set: bool,
    pub unlocked: bool,
    pub fails: u32,
}

fn current(settings: &SettingsState, vault: &Vault) -> PinStatus {
    let snapshot = settings.snapshot();
    PinStatus {
        set: snapshot.pin_check.is_some(),
        unlocked: vault.unlocked(),
        fails: snapshot.pin_fails,
    }
}

fn check_digits(pin: &str) -> Result<(), String> {
    if !(4..=8).contains(&pin.len()) || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("use de 4 a 8 dígitos".into());
    }
    Ok(())
}

fn persist(app: &AppHandle, settings: &SettingsState, next: settings::Settings) {
    settings.update(next.clone());
    settings::save(app, &next);
}

fn expired(last: Option<&str>) -> bool {
    last.and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
        .map(|when| (OffsetDateTime::now_utc() - when).whole_seconds() > FAIL_WINDOW_SECS)
        .unwrap_or(true)
}

#[tauri::command]
pub fn pin_status(
    settings: State<'_, SettingsState>,
    vault: State<'_, Vault>,
) -> PinStatus {
    current(&settings, &vault)
}

#[tauri::command]
pub fn pin_create(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    vault: State<'_, Vault>,
    pin: String,
) -> Result<PinStatus, String> {
    check_digits(&pin)?;
    let mut next = settings.snapshot();
    if next.pin_check.is_some() {
        return Err("PIN já existe".into());
    }
    let salt = secure::new_salt().ok_or("falha ao gerar sal")?;
    let key = secure::derive(&pin, &salt).ok_or("falha ao derivar a chave")?;
    next.pin_salt = Some(salt);
    next.pin_check = Some(secure::encrypt(&key, "hashimemo").ok_or("falha ao cifrar")?);
    next.pin_fails = 0;
    next.pin_last = None;
    persist(&app, &settings, next);
    vault.set(key);
    Ok(current(&settings, &vault))
}

#[tauri::command]
pub fn pin_unlock(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    vault: State<'_, Vault>,
    notes: State<'_, NotesState>,
    pin: String,
) -> Result<PinStatus, String> {
    let mut next = settings.snapshot();
    let salt = next.pin_salt.clone().ok_or("nenhum PIN definido")?;
    let check = next.pin_check.clone().ok_or("nenhum PIN definido")?;
    if expired(next.pin_last.as_deref()) {
        next.pin_fails = 0;
    }

    let key = secure::derive(&pin, &salt).ok_or("falha ao derivar a chave")?;
    if secure::decrypt(&key, &check).is_none() {
        next.pin_fails += 1;
        next.pin_last = Some(
            OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_default(),
        );
        if next.pin_fails >= MAX_FAILS {
            let wiped = notes.wipe_protected();
            next.pin_salt = None;
            next.pin_check = None;
            next.pin_fails = 0;
            next.pin_last = None;
            persist(&app, &settings, next);
            vault.clear();
            let _ = app.emit("notes:changed", ());
            return Err(format!(
                "PIN incorreto 4 vezes — {wiped} nota(s) protegida(s) foram apagadas"
            ));
        }
        let left = MAX_FAILS - next.pin_fails;
        persist(&app, &settings, next);
        return Err(format!("PIN incorreto — mais {left} tentativa(s) antes de apagar"));
    }

    next.pin_fails = 0;
    next.pin_last = None;
    persist(&app, &settings, next);
    vault.set(key);
    let _ = app.emit("notes:changed", ());
    Ok(current(&settings, &vault))
}

#[tauri::command]
pub fn pin_lock(settings: State<'_, SettingsState>, vault: State<'_, Vault>) -> PinStatus {
    vault.clear();
    current(&settings, &vault)
}

#[tauri::command]
pub fn pin_change(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    vault: State<'_, Vault>,
    notes: State<'_, NotesState>,
    old: String,
    new: String,
) -> Result<PinStatus, String> {
    check_digits(&new)?;
    let mut next = settings.snapshot();
    let salt = next.pin_salt.clone().ok_or("nenhum PIN definido")?;
    let check = next.pin_check.clone().ok_or("nenhum PIN definido")?;
    let old_key = secure::derive(&old, &salt).ok_or("falha ao derivar a chave")?;
    if secure::decrypt(&old_key, &check).is_none() {
        return Err("PIN atual incorreto".into());
    }

    let new_salt = secure::new_salt().ok_or("falha ao gerar sal")?;
    let new_key = secure::derive(&new, &new_salt).ok_or("falha ao derivar a chave")?;
    notes.reencrypt_all(&old_key, &new_key)?;
    next.pin_salt = Some(new_salt);
    next.pin_check = Some(secure::encrypt(&new_key, "hashimemo").ok_or("falha ao cifrar")?);
    next.pin_fails = 0;
    next.pin_last = None;
    persist(&app, &settings, next);
    vault.set(new_key);
    let _ = app.emit("notes:changed", ());
    Ok(current(&settings, &vault))
}

#[tauri::command]
pub fn pin_remove(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    vault: State<'_, Vault>,
    notes: State<'_, NotesState>,
    pin: String,
) -> Result<PinStatus, String> {
    let mut next = settings.snapshot();
    let salt = next.pin_salt.clone().ok_or("nenhum PIN definido")?;
    let check = next.pin_check.clone().ok_or("nenhum PIN definido")?;
    let key = secure::derive(&pin, &salt).ok_or("falha ao derivar a chave")?;
    if secure::decrypt(&key, &check).is_none() {
        return Err("PIN incorreto".into());
    }
    notes.release_all(&key)?;
    next.pin_salt = None;
    next.pin_check = None;
    next.pin_fails = 0;
    next.pin_last = None;
    persist(&app, &settings, next);
    vault.clear();
    let _ = app.emit("notes:changed", ());
    Ok(current(&settings, &vault))
}
