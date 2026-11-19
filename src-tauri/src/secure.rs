//! Criptografia do cofre: Argon2id (PIN -> chave) e AES-256-GCM (título/corpo).
use std::sync::Mutex;

use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, KeyInit},
};
use argon2::Argon2;
use base64::{Engine, engine::general_purpose::STANDARD};

const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;

pub fn new_salt() -> String {
    let mut salt = [0u8; SALT_LEN];
    if getrandom::fill(&mut salt).is_err() {
        salt = [7u8; SALT_LEN];
    }
    STANDARD.encode(salt)
}

pub fn derive(pin: &str, salt: &str) -> Option<[u8; 32]> {
    let salt = STANDARD.decode(salt).ok()?;
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(pin.as_bytes(), &salt, &mut key)
        .ok()?;
    Some(key)
}

pub fn encrypt(key: &[u8; 32], text: &str) -> Option<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).ok()?;
    let sealed = cipher
        .encrypt(Nonce::from_slice(&nonce), text.as_bytes())
        .ok()?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&sealed);
    Some(STANDARD.encode(blob))
}

pub fn decrypt(key: &[u8; 32], blob: &str) -> Option<String> {
    let data = STANDARD.decode(blob).ok()?;
    if data.len() <= NONCE_LEN {
        return None;
    }
    let (nonce, sealed) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plain = cipher.decrypt(Nonce::from_slice(nonce), sealed).ok()?;
    String::from_utf8(plain).ok()
}

pub struct Vault {
    key: Mutex<Option<[u8; 32]>>,
}

impl Default for Vault {
    fn default() -> Self {
        Self {
            key: Mutex::new(None),
        }
    }
}

impl Vault {
    pub fn key(&self) -> Option<[u8; 32]> {
        self.key.lock().ok().and_then(|slot| *slot)
    }

    pub fn set(&self, key: [u8; 32]) {
        if let Ok(mut slot) = self.key.lock() {
            *slot = Some(key);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut slot) = self.key.lock() {
            *slot = None;
        }
    }

    pub fn unlocked(&self) -> bool {
        self.key().is_some()
    }
}
