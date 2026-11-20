//! Persistência: um .md por nota em Markdown + frontmatter YAML; resolve caminho por id.
use std::{
    fs, io,
    path::PathBuf,
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

pub const COLORS: [&str; 12] = [
    "mauve", "blue", "green", "peach", "red", "yellow", "teal", "pink", "lavender", "sapphire",
    "maroon", "rosewater",
];

fn random_color() -> String {
    let mut byte = [0u8; 1];
    let index = if getrandom::fill(&mut byte).is_ok() {
        byte[0] as usize % COLORS.len()
    } else {
        0
    };
    COLORS[index].to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub color: String,
    pub group: String,
    pub order: f64,
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub remind_at: String,
    #[serde(default)]
    pub protected: bool,
    #[serde(skip)]
    pub secret_title: String,
    #[serde(skip)]
    pub secret_body: String,
    pub created: String,
    pub updated: String,
    pub mtime: u64,
    #[serde(skip)]
    pub path: PathBuf,
    #[serde(skip)]
    extra: Mapping,
}

#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    Conflict(Box<Note>),
    NotFound,
}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "io: {error}"),
            Self::Conflict(_) => write!(f, "conflict"),
            Self::NotFound => write!(f, "not found"),
        }
    }
}

pub struct Store {
    root: PathBuf,
    notes: Option<PathBuf>,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn slug(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            'a'..='z' | '0'..='9' => out.push(ch),
            'A'..='Z' => out.push(ch.to_ascii_lowercase()),
            'á' | 'à' | 'â' | 'ã' | 'ä' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => out.push('o'),
            'ú' | 'ù' | 'û' | 'ü' => out.push('u'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            _ => out.push('-'),
        }
    }
    let slug = out
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "nota".into()
    } else {
        slug.chars().take(48).collect()
    }
}

fn split_frontmatter(text: &str) -> (String, String) {
    let head = text.strip_prefix('\u{feff}').unwrap_or(text);
    if let Some(rest) = head.strip_prefix("---") {
        let rest = rest.trim_start_matches(['\r', '\n']);
        if let Some(end) = rest.find("\n---") {
            let front = rest[..end].to_string();
            let body = rest[end + 4..].trim_start_matches(['\r', '\n']).to_string();
            return (front, body);
        }
    }
    (String::new(), head.to_string())
}

fn text(map: &Mapping, key: &str) -> String {
    map.get(Value::from(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn number(map: &Mapping, key: &str) -> f64 {
    map.get(Value::from(key))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn flag(map: &Mapping, key: &str) -> bool {
    map.get(Value::from(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

impl Store {
    pub fn new() -> Self {
        Self {
            root: home().join("HashiMemo"),
            notes: None,
        }
    }

    pub fn with_notes(notes: Option<String>) -> Self {
        let notes = notes
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        Self {
            root: home().join("HashiMemo"),
            notes,
        }
    }

    pub fn notes_dir(&self) -> PathBuf {
        self.notes
            .clone()
            .unwrap_or_else(|| self.root.join("notes"))
    }

    pub fn media_dir(&self) -> PathBuf {
        self.root.join("media")
    }

    pub fn ensure(&self) -> io::Result<()> {
        fs::create_dir_all(self.notes_dir())?;
        fs::create_dir_all(self.media_dir())
    }

    fn parse(&self, path: PathBuf) -> Option<Note> {
        let raw = fs::read_to_string(&path).ok()?;
        let mtime = fs::metadata(&path).ok().map(|m| mtime_ms(&m)).unwrap_or(0);
        let (front, body) = split_frontmatter(&raw);
        let map: Mapping = serde_yaml_ng::from_str(&front).unwrap_or_default();

        let id = {
            let value = text(&map, "id");
            if value.is_empty() {
                Uuid::now_v7().to_string()
            } else {
                value
            }
        };

        let color = {
            let value = text(&map, "color");
            if COLORS.contains(&value.as_str()) {
                value
            } else {
                "mauve".into()
            }
        };

        Some(Note {
            id,
            title: text(&map, "title"),
            body,
            color,
            group: text(&map, "group"),
            order: number(&map, "order"),
            pinned: flag(&map, "pinned"),
            hidden: flag(&map, "hidden"),
            remind_at: text(&map, "remind_at"),
            protected: flag(&map, "protected"),
            secret_title: text(&map, "secret_title"),
            secret_body: text(&map, "secret_body"),
            created: text(&map, "created"),
            updated: text(&map, "updated"),
            mtime,
            path,
            extra: map,
        })
    }

    pub fn list(&self) -> Vec<Note> {
        let Ok(entries) = fs::read_dir(self.notes_dir()) else {
            return Vec::new();
        };

        let mut notes: Vec<Note> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            })
            .filter_map(|path| self.parse(path))
            .collect();

        notes.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(a.order.total_cmp(&b.order))
                .then(b.updated.cmp(&a.updated))
        });
        notes
    }

    pub fn fetch(&self, needle: &str) -> Option<Note> {
        let needle = needle.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return None;
        }
        let notes = self.list();
        notes
            .iter()
            .find(|note| note.id == needle)
            .or_else(|| notes.iter().find(|note| note.id.starts_with(&needle)))
            .or_else(|| {
                notes.iter().find(|note| {
                    note.path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| stem.to_ascii_lowercase().contains(&needle))
                })
            })
            .cloned()
    }

    fn unique_path(&self, stem: &str, id: &str) -> PathBuf {
        let dir = self.notes_dir();
        let mut candidate = dir.join(format!("{stem}.md"));
        let mut counter = 2;
        while candidate.exists() {
            if let Some(existing) = self.parse(candidate.clone()) {
                if existing.id == id {
                    return candidate;
                }
            }
            candidate = dir.join(format!("{stem}-{counter}.md"));
            counter += 1;
        }
        candidate
    }

    fn render(&self, note: &Note) -> String {
        let mut map = note.extra.clone();
        for key in [
            "id", "title", "color", "group", "order", "pinned", "hidden", "remind_at", "protected",
            "secret_title", "secret_body", "created", "updated",
        ] {
            map.shift_remove(Value::from(key));
        }

        let mut head = Mapping::new();
        head.insert(Value::from("id"), Value::from(note.id.clone()));
        let (title, _body) = if note.protected {
            (String::new(), String::new())
        } else {
            (note.title.clone(), note.body.clone())
        };
        head.insert(Value::from("title"), Value::from(title));
        head.insert(Value::from("color"), Value::from(note.color.clone()));
        head.insert(Value::from("group"), Value::from(note.group.clone()));
        head.insert(Value::from("order"), Value::from(note.order));
        head.insert(Value::from("pinned"), Value::from(note.pinned));
        head.insert(Value::from("hidden"), Value::from(note.hidden));
        head.insert(Value::from("remind_at"), Value::from(note.remind_at.clone()));
        head.insert(Value::from("protected"), Value::from(note.protected));
        if !note.secret_title.is_empty() {
            head.insert(Value::from("secret_title"), Value::from(note.secret_title.clone()));
        }
        if !note.secret_body.is_empty() {
            head.insert(Value::from("secret_body"), Value::from(note.secret_body.clone()));
        }
        head.insert(Value::from("created"), Value::from(note.created.clone()));
        head.insert(Value::from("updated"), Value::from(note.updated.clone()));
        for (key, value) in map {
            head.insert(key, value);
        }

        let yaml = serde_yaml_ng::to_string(&head).unwrap_or_default();
        let body = if note.protected {
            String::new()
        } else {
            note.body.trim_end().to_string()
        };
        format!("---\n{}---\n\n{}\n", yaml, body)
    }

    fn write(&self, note: &Note) -> Result<Note, Error> {
        let rendered = self.render(note);
        let tmp = note.path.with_extension("md.tmp");
        fs::write(&tmp, rendered)?;
        fs::rename(&tmp, &note.path)?;

        let mtime = fs::metadata(&note.path).map(|m| mtime_ms(&m))?;
        Ok(Note {
            mtime,
            ..note.clone()
        })
    }

    pub fn create(&self, title: &str, body: &str, color: &str, group: &str) -> Result<Note, Error> {
        self.ensure()?;
        let now = now();
        let title = if title.trim().is_empty() {
            "Nova nota".to_string()
        } else {
            title.trim().to_string()
        };
        let order = self.list().iter().map(|note| note.order).fold(0.0, f64::max) + 1.0;
        let created = now.clone();

        let mut note = Note {
            id: Uuid::now_v7().to_string(),
            title,
            body: body.to_string(),
            color: if COLORS.contains(&color) {
                color.into()
            } else {
                random_color()
            },
            group: group.trim().to_string(),
            order,
            pinned: false,
            hidden: false,
            remind_at: String::new(),
            protected: false,
            secret_title: String::new(),
            secret_body: String::new(),
            created: created.clone(),
            updated: now,
            mtime: 0,
            path: PathBuf::new(),
            extra: Mapping::new(),
        };

        let date = created.get(..10).unwrap_or("nota").to_string();
        note.path = self.unique_path(&format!("{date}-{}", slug(&note.title)), &note.id);
        self.write(&note)
    }

    pub fn save(&self, mut note: Note) -> Result<Note, Error> {
        if note.path.as_os_str().is_empty() {
            note.path = self.fetch(&note.id).map(|found| found.path).ok_or(Error::NotFound)?;
        }
        let meta = fs::metadata(&note.path).map_err(|_| Error::NotFound)?;
        if mtime_ms(&meta) != note.mtime {
            let current = self
                .parse(note.path.clone())
                .ok_or(Error::NotFound)?;
            return Err(Error::Conflict(Box::new(current)));
        }

        note.updated = now();
        let date = note.created.get(..10).unwrap_or("nota").to_string();
        let wanted = self.unique_path(&format!("{date}-{}", slug(&note.title)), &note.id);
        if wanted != note.path {
            let previous = note.path.clone();
            note.path = wanted;
            let _ = fs::remove_file(previous);
        }
        self.write(&note)
    }

    pub fn delete(&self, note: &Note) -> Result<(), Error> {
        fs::remove_file(&note.path)?;
        Ok(())
    }

    pub fn search(&self, query: &str) -> Vec<Note> {
        let query = query.to_ascii_lowercase();
        self.list()
            .into_iter()
            .filter(|note| {
                note.title.to_ascii_lowercase().contains(&query)
                    || note.body.to_ascii_lowercase().contains(&query)
                    || note.group.to_ascii_lowercase().contains(&query)
            })
            .collect()
    }
}

impl Default for Store {
    fn default() -> Self {
        Self::new()
    }
}
