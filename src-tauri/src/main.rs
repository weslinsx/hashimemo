use clap::{Parser, Subcommand};
use hashimemo_lib::notes::Store;

#[derive(Parser)]
#[command(
    name = "hashimemo",
    version,
    about = "Notas rápidas em Markdown na borda da tela",
    long_about = None
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Cria uma nota; o texto vira o corpo e a primeira linha o título
    New {
        text: Vec<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long, default_value = "mauve")]
        color: String,
        #[arg(long, default_value = "")]
        group: String,
        #[arg(long)]
        json: bool,
    },
    /// Lista as notas abertas
    List {
        #[arg(long)]
        json: bool,
    },
    /// Mostra uma nota por id, prefixo de id ou trecho do nome do arquivo
    Read {
        needle: String,
        #[arg(long)]
        json: bool,
    },
    /// Busca por termo em título, corpo e grupo
    Search {
        query: Vec<String>,
        #[arg(long)]
        json: bool,
    },
    /// Anexa texto ao corpo de uma nota
    Edit {
        needle: String,
        #[arg(long)]
        append: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long)]
        group: Option<String>,
        #[arg(long)]
        color: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Remove uma nota
    Rm { needle: String },
    /// Imprime as notas recentes em formato de prompt para agentes
    Context {
        #[arg(long, default_value_t = 5)]
        notes: usize,
    },
    /// Mostra a pasta de notas em uso
    Path,
}

fn print_notes(notes: &[hashimemo_lib::notes::Note], json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(notes).unwrap_or_else(|_| "[]".into())
        );
        return;
    }

    for note in notes {
        println!(
            "{}  {:<40}  {:<16}  {}",
            short(&note.id),
            truncate(&note.title, 40),
            truncate(&note.group, 16),
            note.updated.get(..16).unwrap_or(&note.updated)
        );
    }
    if notes.is_empty() {
        println!("nenhuma nota em {}", Store::new().notes_dir().display());
    }
}

fn short(id: &str) -> String {
    id.chars().take(8).collect()
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    text.chars().take(limit.saturating_sub(1)).collect::<String>() + "…"
}

fn fail(message: &str) -> ! {
    eprintln!("hashimemo: {message}");
    std::process::exit(1)
}

fn main() {
    let cli = Cli::parse();
    let Some(command) = cli.command else {
        hashimemo_lib::run();
        return;
    };

    let store = Store::new();
    let _ = store.ensure();

    match command {
        Command::New {
            text,
            title,
            color,
            group,
            json,
        } => {
            let text = text.join(" ");
            let title = title.unwrap_or_else(|| {
                text.lines()
                    .next()
                    .unwrap_or("Nova nota")
                    .chars()
                    .take(80)
                    .collect()
            });
            let note = match store.create(&title, &text, &color, &group) {
                Ok(note) => note,
                Err(error) => fail(&error.to_string()),
            };
            if json {
                println!("{}", serde_json::to_string_pretty(&note).unwrap_or_default());
            } else {
                println!("{}  {}  {}", short(&note.id), note.title, note.path.display());
            }
        }
        Command::List { json } => print_notes(&store.list(), json),
        Command::Read { needle, json } => {
            let note = store.fetch(&needle).unwrap_or_else(|| fail("nota não encontrada"));
            if json {
                println!("{}", serde_json::to_string_pretty(&note).unwrap_or_default());
            } else {
                println!("# {}", note.title);
                println!(
                    "{} · {} · {}",
                    note.group.is_empty().then(|| "sem grupo").unwrap_or(&note.group),
                    note.color,
                    note.updated.get(..16).unwrap_or(&note.updated)
                );
                println!("{}", note.path.display());
                println!();
                println!("{}", note.body);
            }
        }
        Command::Search { query, json } => {
            let query = query.join(" ");
            print_notes(&store.search(&query), json);
        }
        Command::Edit {
            needle,
            append,
            title,
            body,
            group,
            color,
            json,
        } => {
            let mut note = store.fetch(&needle).unwrap_or_else(|| fail("nota não encontrada"));
            if let Some(title) = title {
                note.title = title;
            }
            if let Some(body) = body {
                note.body = body;
            }
            if let Some(group) = group {
                note.group = group;
            }
            if let Some(color) = color {
                note.color = color;
            }
            if let Some(append) = append {
                if !note.body.is_empty() {
                    note.body.push('\n');
                }
                note.body.push_str(&append);
            }
            let note = match store.save(note) {
                Ok(note) => note,
                Err(error) => fail(&error.to_string()),
            };
            if json {
                println!("{}", serde_json::to_string_pretty(&note).unwrap_or_default());
            } else {
                println!("{}  {}  atualizada", short(&note.id), note.title);
            }
        }
        Command::Rm { needle } => {
            let note = store.fetch(&needle).unwrap_or_else(|| fail("nota não encontrada"));
            if let Err(error) = store.delete(&note) {
                fail(&error.to_string());
            }
            println!("removida: {}", note.title);
        }
        Command::Context { notes } => {
            let mut all = store.list();
            all.sort_by(|a, b| b.updated.cmp(&a.updated));
            println!("# Contexto HashiMemo");
            println!();
            println!("Notas recentes em {}:", store.notes_dir().display());
            for note in all.iter().take(notes) {
                println!();
                println!("## {}", note.title);
                if !note.group.is_empty() {
                    println!("grupo: {}", note.group);
                }
                println!("arquivo: {}", note.path.display());
                println!();
                println!("{}", note.body);
            }
        }
        Command::Path => println!("{}", store.notes_dir().display()),
    }
}

