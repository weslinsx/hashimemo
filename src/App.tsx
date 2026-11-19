import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Md } from "./md";
import { Kami } from "./Kami";
import { RichEditor, type Capture } from "./RichEditor";

type Level = "Docked" | "Focus" | "Max";

type WindowState = {
  level: Level;
  docked: boolean;
  hyprland: boolean;
  monitors: number;
};

type Settings = {
  font_scale: number;
  autostart: boolean;
  theme: string;
  notes_root: string | null;
  motion: string;
  autosave: boolean;
  minimize_mode: string;
};

type Note = {
  id: string;
  title: string;
  body: string;
  color: string;
  group: string;
  order: number;
  pinned: boolean;
  hidden: boolean;
  protected: boolean;
  remind_at: string;
  created: string;
  updated: string;
  mtime: number;
};

type PinStatus = { set: boolean; unlocked: boolean; fails: number };

const THEMES = [
  { id: "mocha", label: "Catppuccin Mocha" },
  { id: "latte", label: "Catppuccin Latte (claro)" },
  { id: "breeze", label: "Breeze Dark" },
];

const MOTIONS = [
  { id: "off", label: "Desligado" },
  { id: "fast", label: "Ágil" },
  { id: "fluid", label: "Fluido" },
  { id: "smooth", label: "Sereno" },
  { id: "slow", label: "Cadenciado" },
];

const COLORS = [
  "mauve",
  "blue",
  "green",
  "peach",
  "red",
  "yellow",
  "teal",
  "pink",
  "lavender",
  "sapphire",
  "maroon",
  "rosewater",
];

const ACCENT: Record<string, string> = {
  mauve: "var(--color-mauve)",
  blue: "var(--color-blue)",
  green: "var(--color-green)",
  peach: "var(--color-peach)",
  red: "var(--color-red)",
  yellow: "var(--color-yellow)",
  teal: "var(--color-teal)",
  pink: "var(--color-pink)",
  lavender: "var(--color-lavender)",
  sapphire: "var(--color-sapphire)",
  maroon: "var(--color-maroon)",
  rosewater: "var(--color-rosewater)",
};

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(
    when.getHours(),
  )}:${pad(when.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return "";
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? "" : when.toISOString();
}

function clock(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relative(iso: string): string {
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return "";
  const minutes = Math.round((Date.now() - when) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ontem" : `há ${days} d`;
}

function IconDock({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2" width="13" height="12" rx="2.5" opacity={active ? 1 : 0.7} />
      <line x1="10.5" y1="2" x2="10.5" y2="14" opacity={active ? 1 : 0.35} />
    </svg>
  );
}

function IconExpand({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.4">
      {full ? (
        <>
          <path d="M6 2v4H2" />
          <path d="M10 14v-4h4" />
        </>
      ) : (
        <>
          <path d="M2 6V2h4" />
          <path d="M14 10v4h-4" />
        </>
      )}
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5" />
    </svg>
  );
}

function NoteCard({
  note,
  onOpen,
  onContext,
  onPointerDown,
}: {
  note: Note;
  onOpen: () => void;
  onContext: (event: MouseEvent) => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
}) {
  const accent = ACCENT[note.color] ?? "var(--color-mauve)";
  const preview = note.body
    .replace(/^#+ .*\n/, "")
    .replace(/^\[Image \d+\]\s*$/gm, "")
    .trim();
  return (
    <article
      data-note={note.id}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      onContextMenu={onContext}
      className="rail-card group relative cursor-pointer touch-none overflow-hidden px-3 py-2.5"
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <header className="mb-1 flex items-center gap-2 pl-1.5">
        <h3 className="truncate text-sm font-semibold tracking-tight">{note.title || "Sem título"}</h3>
        {note.pinned && (
          <span className="rounded bg-surface0/70 px-1 py-px text-[0.6rem] uppercase tracking-wider text-subtext1">
            fixa
          </span>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          title="Abrir no foco (70%)"
          className="ml-auto rounded p-1 text-overlay0 opacity-0 transition hover:bg-surface0 hover:text-text group-hover:opacity-100"
        >
          <IconExpand full={false} />
        </button>
      </header>
      {preview ? (
        <Md text={preview} className="line-clamp-4 pl-1.5 text-xs leading-relaxed text-subtext1" />
      ) : (
        <p className="pl-1.5 text-xs text-subtext1">vazia</p>
      )}
      <footer className="mt-2 flex items-center gap-2 pl-1.5 text-[0.65rem] text-overlay0">
        <span className="flex items-center gap-1 rounded bg-surface0/60 px-1.5 py-0.5 text-subtext0">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {note.group || "sem grupo"}
        </span>
        {note.remind_at && (
          <span className="flex items-center gap-1 rounded bg-yellow/15 px-1.5 py-0.5 text-yellow">
            <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 7a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7zM6.5 13a1.5 1.5 0 0 0 3 0" />
            </svg>
            {clock(note.remind_at)}
          </span>
        )}
        <span className="ml-auto tabular-nums">{relative(note.created)}</span>
      </footer>
    </article>
  );
}

function NoteMenu({
  note,
  x,
  y,
  onEdit,
  onFocus,
  onPin,
  onHide,
  onColor,
  onDelete,
  onClose,
}: {
  note: Note;
  x: number;
  y: number;
  onEdit: () => void;
  onFocus: () => void;
  onPin: () => void;
  onHide: () => void;
  onColor: (color: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 196));
  const top = Math.max(8, Math.min(y, window.innerHeight - 216));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-50 w-44 overflow-hidden rounded-lg border border-surface1/70 bg-mantle py-1 text-xs shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)] menu-enter"
        style={{ left, top }}
      >
        <button
          onClick={() => {
            onEdit();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
        >
          Editar nota
        </button>
        <button
          onClick={() => {
            onFocus();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
        >
          Abrir no foco
        </button>
        <button
          onClick={() => {
            onPin();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
        >
          {note.pinned ? "Desafixar" : "Fixar no topo"}
        </button>
        <button
          onClick={() => {
            onHide();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
        >
          {note.hidden ? "Mostrar nota" : "Ocultar nota"}
        </button>

        <div className="my-1 border-t border-surface0/70" />
        <div className="flex items-center gap-1.5 px-3 py-1">
          {COLORS.map((color) => (
            <button
              key={color}
              title={color}
              onClick={() => {
                onColor(color);
                onClose();
              }}
              className={`h-3.5 w-3.5 rounded-full transition hover:scale-110 ${
                note.color === color ? "ring-2 ring-text/70" : "opacity-70"
              }`}
              style={{ background: ACCENT[color] }}
            />
          ))}
        </div>

        <div className="my-1 border-t border-surface0/70" />
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red/90 transition hover:bg-red/15 hover:text-red"
        >
          Excluir nota
        </button>
      </div>
    </>
  );
}

function GroupPicker({
  value,
  groups,
  onChange,
}: {
  value: string;
  groups: string[];
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="grupo"
        className="w-32 rounded-md border border-surface0/60 bg-mantle/60 py-1 pr-6 pl-2 text-xs outline-none transition focus:border-mauve/70"
      />
      <button
        type="button"
        title="Escolher grupo"
        onClick={() => setOpen((current) => !current)}
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1 text-[0.6rem] text-overlay0 transition hover:text-text"
      >
        ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-30 mt-1 max-h-44 w-40 overflow-y-auto rounded-md border border-surface1/70 bg-mantle py-1 text-xs shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)] menu-enter">
            {groups
              .filter((name) => name !== value)
              .map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className="block w-full truncate px-2.5 py-1 text-left text-subtext1 transition hover:bg-surface0 hover:text-text"
                >
                  {name}
                </button>
              ))}
            {groups.length === 0 && <p className="px-2.5 py-1 text-overlay0">nenhum grupo ainda</p>}
            {value.trim() && !groups.includes(value.trim()) && (
              <p className="border-t border-surface0/70 px-2.5 py-1 text-[0.65rem] text-overlay0">
                Enter cria “{value.trim()}”
              </p>
            )}
            {value && (
              <button
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="w-full border-t border-surface0/70 px-2.5 py-1 text-left text-overlay0 transition hover:bg-surface0 hover:text-red"
              >
                sem grupo
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Editor({
  note,
  groups,
  onChange,
  onClose,
  onDelete,
  onCapture,
  onError,
  onSave,
  indent = false,
  inline = false,
}: {
  note: Note;
  groups: string[];
  onChange: (next: Note) => void;
  onClose: () => void;
  onDelete: () => void;
  onCapture: () => Promise<Capture | null>;
  onError?: (message: string) => void;
  onSave: () => void;
  indent?: boolean;
  inline?: boolean;
}) {
  const [remindOpen, setRemindOpen] = useState(false);
  const [raw, setRaw] = useState(false);

  return (
    <div
      className={
        inline
          ? "relative z-10 flex min-h-0 w-full flex-1 flex-col bg-base level-enter"
          : `absolute inset-y-0 right-0 z-20 flex flex-col bg-base editor-enter ${
              indent ? "left-[360px] border-l border-surface0/70" : "left-0"
            }`
      }
    >
      <div className="flex items-center gap-2 border-b border-surface0/70 px-3 py-2">
        <button
          onClick={onClose}
          className="rounded bg-surface0/70 px-2 py-1 text-xs text-subtext1 transition hover:bg-surface1"
        >
          ← voltar
        </button>
        <button
          onClick={onSave}
          title="Salvar agora"
          className="rounded bg-mauve/20 px-2 py-1 text-xs text-mauve transition hover:bg-mauve/30"
        >
          salvar
        </button>
        <span className="ml-auto text-[0.65rem] text-overlay0">{relative(note.updated)}</span>
        <button
          onClick={() => onChange({ ...note, pinned: !note.pinned })}
          title={note.pinned ? "Desafixar" : "Fixar no topo"}
          className={`rounded p-1.5 transition hover:bg-surface0 ${
            note.pinned ? "text-mauve" : "text-overlay0"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M6 2h4l-.5 4 2 2v1.5H4.5V8l2-2z" />
            <path d="M8 9.5V14" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          title="Excluir nota"
          className="rounded p-1.5 text-overlay0 transition hover:bg-red/15 hover:text-red"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-hidden py-3">
        <input
          value={note.title}
          onChange={(event) => onChange({ ...note, title: event.target.value })}
          placeholder="Título"
          className="mx-3 rounded-md border border-surface0/60 bg-mantle/60 px-2.5 py-2 text-sm font-semibold outline-none transition focus:border-mauve/70"
        />
        <div className="mx-3 flex items-center gap-2">
          <GroupPicker
            value={note.group}
            groups={groups}
            onChange={(group) => onChange({ ...note, group })}
          />
        </div>
        <div className="mx-3 flex flex-wrap items-center gap-1.5">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => onChange({ ...note, color })}
              title={color}
              className={`h-3.5 w-3.5 rounded-full transition ${
                note.color === color ? "ring-2 ring-text/70 ring-offset-1 ring-offset-base" : "opacity-60 hover:opacity-100"
              }`}
              style={{ background: ACCENT[color] }}
            />
          ))}
        </div>

        {remindOpen && (
          <div className="mx-3 flex items-center gap-2 rounded-md border border-surface0/60 bg-mantle/60 px-2 py-1 text-xs">
            <span className="text-overlay0">lembrete</span>
            <input
              type="datetime-local"
              value={toLocalInput(note.remind_at)}
              onChange={(event) =>
                onChange({ ...note, remind_at: fromLocalInput(event.target.value) })
              }
              className="min-w-0 flex-1 bg-transparent text-subtext1 outline-none"
            />
            {note.remind_at && (
              <button
                onClick={() => onChange({ ...note, remind_at: "" })}
                className="rounded px-1.5 py-0.5 text-overlay0 transition hover:bg-surface0 hover:text-red"
              >
                limpar
              </button>
            )}
          </div>
        )}

        {raw ? (
          <textarea
            value={note.body}
            onChange={(event) => onChange({ ...note, body: event.target.value })}
            placeholder="Markdown cru…"
            spellCheck={false}
            className="mx-3 flex-1 resize-none rounded-md border border-surface0/60 bg-mantle/60 px-2.5 py-2 font-mono text-xs leading-relaxed outline-none transition focus:border-mauve/70"
          />
        ) : (
          <RichEditor
            key={note.id}
            value={note.body}
            onChange={(body) => onChange({ ...note, body })}
            onCapture={onCapture}
            onError={onError}
            onRemind={() => setRemindOpen((value) => !value)}
            reminding={Boolean(note.remind_at)}
          />
        )}
        <div className="mx-3 flex items-center gap-1 text-[0.6rem] text-overlay0">
          <span className="tabular-nums">{note.id.slice(0, 8)}</span>
          <button
            onClick={() => setRaw((value) => !value)}
            title={raw ? "Usar editor" : "Editar Markdown cru"}
            className="ml-auto rounded px-1.5 py-0.5 transition hover:bg-surface0 hover:text-text"
          >
            {raw ? "editor" : "md"}
          </button>
          <span>autosave</span>
        </div>
      </div>
    </div>
  );
}

const OPENCODE_HELP = `Cole este texto na IA que você usa (ChatGPT, Claude, Gemini, Copilot ou um agente local) para ela aprender a ler e gravar aqui.

---

Você tem acesso ao HashiMemo, um app local de notas em Markdown na borda da tela.

- Pasta das notas: \`C:\\Users\\voxdata\\HashiMemo\\notes\` (um .md por nota, frontmatter YAML com title, group, color, pinned, hidden, remind_at, protected).
- CLI no PATH: \`hashimemo\`.
- Comandos: \`hashimemo list\`, \`hashimemo search "termo"\`, \`hashimemo read "id ou trecho"\`, \`hashimemo new --group OpenCode --title "Título" "corpo"\`, \`hashimemo edit "trecho" --append "linha"\`, \`hashimemo context --notes 5\`, \`hashimemo path\`.
- Notas com \`protected: true\` estão cifradas e não podem ser lidas por você.
- Ao criar algo para o usuário ler (decisão, pendência, resumo), grave no grupo \`OpenCode\` e responda só com o título.
- Nunca copie senhas ou segredos da nota para o chat.`;

function copyText(value: string) {
  void navigator.clipboard.writeText(value).catch(() => {});
}

function SettingsPanel({
  settings,
  notesPath,
  hidden,
  pin,
  onChange,
  onUnhide,
  onPin,
  onLock,
  onClose,
}: {
  settings: Settings;
  notesPath: string;
  hidden: Note[];
  pin: PinStatus;
  onChange: (next: Settings) => void;
  onUnhide: (note: Note) => void;
  onPin: (mode: "create" | "unlock" | "change" | "remove") => void;
  onLock: () => void;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(settings.notes_root ?? "");
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-mantle level-enter">
      <div className="flex items-center gap-2 border-b border-surface0/70 px-3 py-2.5">
        <span className="text-sm font-semibold">Configurações</span>
        <button
          onClick={onClose}
          className="ml-auto rounded-md px-2 py-1 text-xs text-overlay0 transition hover:bg-surface0 hover:text-text"
        >
          fechar
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4 text-sm">
        <section>
          <label htmlFor="theme" className="mb-2 block text-subtext1">
            Tema
          </label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(event) => onChange({ ...settings, theme: event.target.value })}
            className="w-full rounded-md border border-surface0/60 bg-base px-2 py-1.5 text-sm outline-none focus:border-mauve/70"
          >
            {THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </section>

        <section>
          <label htmlFor="minimize" className="mb-2 block text-subtext1">
            Ao minimizar
          </label>
          <select
            id="minimize"
            value={settings.minimize_mode}
            onChange={(event) => onChange({ ...settings, minimize_mode: event.target.value })}
            className="w-full rounded-md border border-surface0/60 bg-base px-2 py-1.5 text-sm outline-none focus:border-mauve/70"
          >
            <option value="bubble">Bolinha (Kami)</option>
            <option value="hide">Só ocultar</option>
          </select>
        </section>

        <section>
          <label htmlFor="motion" className="mb-2 block text-subtext1">
            Animação
          </label>
          <select
            id="motion"
            value={settings.motion}
            onChange={(event) => onChange({ ...settings, motion: event.target.value })}
            className="w-full rounded-md border border-surface0/60 bg-base px-2 py-1.5 text-sm outline-none focus:border-mauve/70"
          >
            {MOTIONS.map((motion) => (
              <option key={motion.id} value={motion.id}>
                {motion.label}
              </option>
            ))}
          </select>
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="scale" className="text-subtext1">
              Tamanho da fonte
            </label>
            <span className="tabular-nums text-xs text-overlay0">{settings.font_scale}%</span>
          </div>
          <input
            id="scale"
            type="range"
            min={80}
            max={160}
            step={5}
            value={settings.font_scale}
            onChange={(event) => onChange({ ...settings, font_scale: Number(event.target.value) })}
            className="w-full accent-mauve"
          />
        </section>

        <section className="flex items-start gap-3">
          <input
            id="autostart"
            type="checkbox"
            checked={settings.autostart}
            onChange={(event) => onChange({ ...settings, autostart: event.target.checked })}
            className="mt-1 h-4 w-4 accent-mauve"
          />
          <label htmlFor="autostart" className="text-subtext1">
            Abrir com o sistema
            <span className="mt-0.5 block text-xs text-overlay0">
              Inicia oculto na bandeja, fora da barra de tarefas.
            </span>
          </label>
        </section>

        <section className="flex items-start gap-3">
          <input
            id="autosave"
            type="checkbox"
            checked={settings.autosave}
            onChange={(event) => onChange({ ...settings, autosave: event.target.checked })}
            className="mt-1 h-4 w-4 accent-mauve"
          />
          <label htmlFor="autosave" className="text-subtext1">
            Salvamento automático
            <span className="mt-0.5 block text-xs text-overlay0">
              Desligado: a nota só é gravada quando você clica em Salvar.
            </span>
          </label>
        </section>

        <section className="border-t border-surface0/60 pt-4">
          <label htmlFor="notes-root" className="mb-1.5 block text-subtext1">
            Pasta das notas
          </label>
          <div className="flex gap-1.5">
            <input
              id="notes-root"
              value={root}
              onChange={(event) => setRoot(event.target.value)}
              placeholder={notesPath}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-surface0/60 bg-base px-2 py-1 text-xs outline-none focus:border-mauve/70"
            />
            <button
              onClick={() => onChange({ ...settings, notes_root: root.trim() || null })}
              className="rounded-md bg-surface0 px-2 py-1 text-xs text-subtext1 transition hover:bg-surface1"
            >
              aplicar
            </button>
            <button
              onClick={() => void invoke("open_notes_dir").catch(() => {})}
              title="Abrir a pasta de notas"
              className="rounded-md bg-surface0 px-2 py-1 text-xs text-subtext1 transition hover:bg-surface1"
            >
              abrir
            </button>
          </div>
          <p className="mt-1.5 break-all text-[0.65rem] text-overlay0">
            vazio = padrão (~/HashiMemo/notes) · atual: {notesPath}
          </p>
        </section>

        <section className="border-t border-surface0/60 pt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="flex items-center gap-1.5 text-subtext1">
              <Kami size={16} pose="bloqueado" />
              Notas protegidas
            </span>
            <span className="text-xs text-overlay0">{hidden.length}</span>
          </div>
          {!pin.set ? (
            <div className="space-y-1.5">
              <p className="text-xs leading-relaxed text-overlay0">
                Ocultar uma nota cifra o conteúdo com um PIN. Sem o PIN, não há como ler.
              </p>
              <button
                onClick={() => onPin("create")}
                className="rounded-md bg-surface0 px-2 py-1 text-xs text-subtext1 transition hover:bg-surface1"
              >
                criar PIN
              </button>
            </div>
          ) : pin.unlocked ? (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-subtext0">desbloqueado</span>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => onPin("change")}
                    className="rounded bg-surface0/70 px-1.5 py-0.5 text-[0.65rem] text-subtext1 transition hover:bg-surface1"
                  >
                    alterar
                  </button>
                  <button
                    onClick={() => onPin("remove")}
                    className="rounded bg-surface0/70 px-1.5 py-0.5 text-[0.65rem] text-subtext1 transition hover:bg-surface1"
                  >
                    remover
                  </button>
                  <button
                    onClick={onLock}
                    className="rounded bg-surface0/70 px-1.5 py-0.5 text-[0.65rem] text-subtext1 transition hover:bg-surface1"
                  >
                    travar
                  </button>
                </div>
              </div>
              {hidden.length === 0 ? (
                <p className="text-overlay0">Nenhuma nota protegida. Botão direito na nota → Ocultar.</p>
              ) : (
                <ul className="space-y-1">
                  {hidden.map((note) => (
                    <li key={note.id} className="flex items-center gap-2">
                      <span className="truncate text-subtext0">
                        {note.title || "Nota protegida"}
                      </span>
                      <button
                        onClick={() => onUnhide(note)}
                        className="ml-auto shrink-0 rounded bg-surface0/70 px-1.5 py-0.5 text-[0.65rem] text-subtext1 transition hover:bg-surface1"
                      >
                        mostrar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-subtext0">
                {hidden.length} nota(s) cifrada(s) — 4 tentativas erradas apagam
              </span>
              <button
                onClick={() => onPin("unlock")}
                className="ml-auto shrink-0 rounded bg-surface0 px-2 py-1 text-subtext1 transition hover:bg-surface1"
              >
                desbloquear
              </button>
            </div>
          )}
        </section>

        <section className="border-t border-surface0/60 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-subtext1">Integração IA</p>
            <button
              onClick={() => copyText(`Você tem acesso ao HashiMemo, um app local de notas em Markdown.\n\n- Pasta: C:\\Users\\voxdata\\HashiMemo\\notes (.md com frontmatter YAML: title, group, color, pinned, hidden, remind_at, protected)\n- CLI no PATH: hashimemo\n- Comandos: hashimemo list | search "termo" | read "id" | new --group OpenCode --title "Título" "corpo" | edit "trecho" --append "linha" | context --notes 5 | path\n- notas com protected: true estão cifradas e ilegíveis\n- grave o que for para o usuário no grupo OpenCode e responda só com o título\n- nunca copie senhas para o chat`)}
              className="rounded bg-surface0/70 px-1.5 py-0.5 text-[0.65rem] text-subtext1 transition hover:bg-surface1"
            >
              copiar
            </button>
          </div>
          <Md
            text={OPENCODE_HELP}
            className="rounded-md border border-surface0/60 bg-base/60 px-2.5 py-2 text-xs leading-relaxed text-subtext0 select-text"
          />
        </section>

        <section className="space-y-1.5 border-t border-surface0/60 pt-4 text-xs text-overlay0">
          <p className="flex justify-between gap-3">
            <span>Mostrar/ocultar</span>
            <kbd className="rounded bg-surface0/70 px-1.5 py-0.5 text-subtext1">Ctrl+Alt+N</kbd>
          </p>
          <p className="flex justify-between gap-3">
            <span>Voltar ao rail</span>
            <kbd className="rounded bg-surface0/70 px-1.5 py-0.5 text-subtext1">Esc</kbd>
          </p>
          <p className="flex justify-between gap-3">
            <span>Versão</span>
            <span className="tabular-nums text-subtext1">0.3.1</span>
          </p>
        </section>
      </div>
    </div>
  );
}

function GroupMenu({
  name,
  count,
  pinned,
  x,
  y,
  onPin,
  onMove,
  onClear,
  onDelete,
  onClose,
}: {
  name: string;
  count: number;
  pinned: boolean;
  x: number;
  y: number;
  onPin: () => void;
  onMove: (delta: number) => void;
  onClear: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x, window.innerWidth - 200));
  const top = Math.max(8, Math.min(y, window.innerHeight - 220));
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-subtext1 transition hover:bg-surface0 hover:text-text";
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-50 w-48 overflow-hidden rounded-lg border border-surface1/70 bg-mantle py-1 text-xs shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)] menu-enter"
        style={{ left, top }}
      >
        <p className="truncate px-3 py-1 text-[0.6rem] tracking-wider text-overlay0 uppercase">
          {name} · {count}
        </p>
        <button
          onClick={() => {
            onPin();
            onClose();
          }}
          className={item}
        >
          {pinned ? "Desafixar grupo" : "Fixar no início"}
        </button>
        <button
          onClick={() => {
            onMove(-1);
            onClose();
          }}
          className={item}
        >
          Mover para ←
        </button>
        <button
          onClick={() => {
            onMove(1);
            onClose();
          }}
          className={item}
        >
          Mover para →
        </button>
        <div className="my-1 border-t border-surface0/70" />
        <button
          onClick={() => {
            onClear();
            onClose();
          }}
          className={item}
        >
          Limpar grupo
        </button>
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red/90 transition hover:bg-red/15 hover:text-red"
        >
          Excluir grupo
        </button>
      </div>
    </>
  );
}

function PinDialog({
  mode,
  error,
  onSubmit,
  onClose,
}: {
  mode: "create" | "unlock" | "change" | "remove";
  error: string;
  onSubmit: (value: string, next?: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [next, setNext] = useState("");
  const [local, setLocal] = useState("");
  const titles = {
    create: "Criar PIN",
    unlock: "Desbloquear notas",
    change: "Alterar PIN",
    remove: "Remover PIN",
  };
  const hints = {
    create: "De 4 a 8 dígitos. Sem ele as notas protegidas não abrem.",
    unlock: "4 tentativas erradas apagam as notas protegidas.",
    change: "O PIN atual cifra as notas; o novo passa a valer para todas.",
    remove: "Remove o PIN e devolve todas as notas ocultas à lista.",
  };
  const digits = (text: string) => /^\d{4,8}$/.test(text);
  const submit = () => {
    if (!digits(value)) return setLocal("use de 4 a 8 dígitos");
    if (mode === "change" && !digits(next)) return setLocal("o novo PIN precisa de 4 a 8 dígitos");
    setLocal("");
    onSubmit(value, mode === "change" ? next : undefined);
  };
  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-crust/70 px-4 backdrop-blur-sm">
      <div className="w-full rounded-xl border border-surface1/70 bg-mantle p-4 shadow-2xl pop-enter">
        <p className="text-sm font-semibold">{titles[mode]}</p>
        <p className="mt-1 text-xs leading-relaxed text-subtext0">{hints[mode]}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => event.key === "Enter" && mode !== "change" && submit()}
          placeholder={mode === "change" ? "PIN atual" : "PIN"}
          className="mt-3 w-full rounded-md border border-surface0/60 bg-base px-2.5 py-1.5 tracking-[0.3em] outline-none focus:border-mauve/70"
        />
        {mode === "change" && (
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={next}
            onChange={(event) => setNext(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder="novo PIN"
            className="mt-2 w-full rounded-md border border-surface0/60 bg-base px-2.5 py-1.5 tracking-[0.3em] outline-none focus:border-mauve/70"
          />
        )}
        {(local || error) && <p className="mt-2 text-xs text-red">{local || error}</p>}
        <div className="mt-3 flex justify-end gap-2 text-xs">
          <button
            onClick={onClose}
            className="rounded-md px-2.5 py-1.5 text-subtext1 transition hover:bg-surface0"
          >
            cancelar
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-mauve px-2.5 py-1.5 font-medium text-crust transition hover:bg-lavender"
          >
            confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [win, setWin] = useState<WindowState>({ level: "Docked", docked: true, hyprland: false, monitors: 1 });
  const [settings, setSettings] = useState<Settings>({
    font_scale: 100,
    autostart: true,
    theme: "mocha",
    notes_root: null,
    motion: "fluid",
    autosave: true,
    minimize_mode: "bubble",
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesPath, setNotesPath] = useState("");
  const [draft, setDraft] = useState<Note | null>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(() => localStorage.getItem("hashimemo.tab") ?? "Todos");
  const [menu, setMenu] = useState<{ note: Note; x: number; y: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [collapsing, setCollapsing] = useState(false);
  const [pin, setPin] = useState<PinStatus>({ set: false, unlocked: false, fails: 0 });
  const [pinDialog, setPinDialog] = useState<{
    mode: "create" | "unlock" | "change" | "remove";
    action?: "hide" | "show";
    note?: Note;
  } | null>(null);
  const [pinError, setPinError] = useState("");
  const [pending, setPending] = useState<Note | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    body: string;
    run: () => void;
  } | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("hashimemo.groups");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [pinnedGroups, setPinnedGroups] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("hashimemo.pinnedGroups");
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const [sort, setSort] = useState<"new" | "old" | "custom">(() => {
    const saved = localStorage.getItem("hashimemo.sort");
    return saved === "old" || saved === "custom" ? saved : "new";
  });
  const [groupDrag, setGroupDrag] = useState<{
    name: string;
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const [noteDrag, setNoteDrag] = useState<{
    id: string;
    label: string;
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const skipClick = useRef(false);
  const saved = useRef<string>("");
  const tabsRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    invoke<Note[]>("list_notes").then(setNotes).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<WindowState>("window_state").then(setWin).catch(() => {});
    invoke<Settings>("get_settings").then(setSettings).catch(() => {});
    invoke<string>("notes_dir").then(setNotesPath).catch(() => {});
    invoke<PinStatus>("pin_status").then(setPin).catch(() => {});
    reload();
    const unlisten = listen("notes:changed", () => reload());
    const collapse = listen("app:collapse", () => {
      setCollapsing(true);
      window.setTimeout(() => setCollapsing(false), 600);
    });
    return () => {
      void unlisten.then((off) => off());
      void collapse.then((off) => off());
    };
  }, [reload]);

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(settings.font_scale / 100));
  }, [settings.font_scale]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || "mocha";
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = settings.motion || "fluid";
  }, [settings.motion]);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    invoke<Settings>("update_settings", { settings: next })
      .then(async (applied) => {
        setSettings(applied);
        if (applied.notes_root !== settings.notes_root) {
          setNotesPath(await invoke<string>("notes_dir").catch(() => ""));
          reload();
        }
      })
      .catch(() => {});
  }, [reload, settings.notes_root]);

  const setLevel = useCallback(async (level: Level) => {
    setBusy(true);
    try {
      setWin(await invoke<WindowState>("set_level", { level }));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleDock = useCallback(async () => {
    setBusy(true);
    try {
      setWin(await invoke<WindowState>("toggle_dock"));
    } finally {
      setBusy(false);
    }
  }, []);

  const cycleMonitor = useCallback(async () => {
    setBusy(true);
    try {
      setWin(await invoke<WindowState>("cycle_monitor"));
    } finally {
      setBusy(false);
    }
  }, []);

  const restoreFocus = useRef(false);
  const levelRef = useRef(win.level);

  useEffect(() => {
    levelRef.current = win.level;
  }, [win.level]);

  useEffect(() => {
    const current = getCurrentWindow();
    const unlisten = current.onFocusChanged(({ payload: focused }) => {
      if (!focused && levelRef.current === "Focus") {
        restoreFocus.current = true;
        void setLevel("Docked");
      } else if (focused && restoreFocus.current) {
        restoreFocus.current = false;
        void setLevel("Focus");
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [setLevel]);

  const open = useCallback(
    (note: Note, expand = false) => {
      if (draft && draft.id !== note.id && JSON.stringify(draft) !== saved.current) {
        void invoke("update_note", { note: draft }).catch(() => {});
      }
      saved.current = JSON.stringify(note);
      setDraft(note);
      setConflict(null);
      if (expand && win.level === "Docked") void setLevel("Focus");
    },
    [draft, setLevel, win.level],
  );

  const closeEditor = useCallback(() => {
    setDraft(null);
    setConflict(null);
    setNotes((current) => current.map((note) => (draft && note.id === draft.id ? draft : note)));
  }, [draft]);

  const createNote = useCallback(() => {
    const now = new Date().toISOString();
    const note: Note = {
      id: "",
      title: "",
      body: "",
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      group: tab === "Todos" ? "" : tab,
      order: 0,
      pinned: false,
      hidden: false,
      protected: false,
      remind_at: "",
      created: now,
      updated: now,
      mtime: 0,
    };
    saved.current = "";
    setDraft(note);
    setConflict(null);
    if (win.level === "Docked") void setLevel("Focus");
  }, [setLevel, tab, win.level]);

  const commitDraft = useCallback(async () => {
    if (!draft) return;
    if (!draft.id) {
      const created = await invoke<Note>("create_note", {
        title: draft.title,
        body: draft.body,
        color: draft.color,
        group: draft.group,
      }).catch(() => null);
      if (!created) {
        setNotice("não consegui salvar a nota");
        setTimeout(() => setNotice(""), 5000);
        return;
      }
      const extra: Note = {
        ...created,
        pinned: draft.pinned,
        hidden: draft.hidden,
        remind_at: draft.remind_at,
      };
      const savedNote = await invoke<Note>("update_note", { note: extra }).catch(() => created);
      saved.current = JSON.stringify(savedNote);
      setDraft(savedNote);
      reload();
      return;
    }
    const savedNote = await invoke<Note>("update_note", { note: draft }).catch(() => null);
    if (!savedNote) {
      setNotice("não consegui salvar a nota");
      setTimeout(() => setNotice(""), 5000);
      return;
    }
    saved.current = JSON.stringify(savedNote);
    setDraft(savedNote);
    reload();
  }, [draft, reload]);

  const remove = useCallback(async () => {
    if (!draft) return;
    await invoke("delete_note", { id: draft.id }).catch(() => {});
    setDraft(null);
    reload();
  }, [draft, reload]);

  const capture = useCallback(async (): Promise<Capture | null> => {
    if (!draft) return null;
    try {
      const shot = await invoke<{
        path: string;
        title: string;
        app: string;
        url: string | null;
      }>("capture_window");
      const title = shot.title.length > 60 ? `${shot.title.slice(0, 57)}…` : shot.title;
      const label = [shot.app, title].filter(Boolean).join(" — ") || "captura";
      return {
        src: convertFileSrc(shot.path),
        alt: label.replace(/[[\]]/g, ""),
        source: shot.url ? `${label} (${shot.url})` : label,
      };
    } catch (error) {
      setNotice(String(error));
      setTimeout(() => setNotice(""), 4000);
      return null;
    }
  }, [draft]);

  const togglePin = useCallback(
    async (note: Note) => {
      await invoke("update_note", { note: { ...note, pinned: !note.pinned } }).catch(() => {});
      reload();
    },
    [reload],
  );

  const toggleHidden = useCallback(
    async (note: Note) => {
      const target = !note.hidden;
      if (target) {
        if (!pin.set) return setPinDialog({ mode: "create", action: "hide", note });
        if (!pin.unlocked) return setPinDialog({ mode: "unlock", action: "hide", note });
        await invoke("set_protected", { id: note.id, protected: true }).catch((error) => {
          setNotice(String(error));
          setTimeout(() => setNotice(""), 5000);
        });
      } else {
        if (!pin.unlocked) return setPinDialog({ mode: "unlock", action: "show", note });
        await invoke("set_protected", { id: note.id, protected: false }).catch((error) => {
          setNotice(String(error));
          setTimeout(() => setNotice(""), 5000);
        });
      }
      reload();
    },
    [pin.set, pin.unlocked, reload],
  );

  const lockNotes = useCallback(async () => {
    setPin(await invoke<PinStatus>("pin_lock"));
    setDraft(null);
    reload();
  }, [reload]);

  const submitPin = useCallback(
    async (value: string, next?: string) => {
      if (!pinDialog) return;
      setPinError("");
      try {
        const status = await invoke<PinStatus>(
          pinDialog.mode === "create"
            ? "pin_create"
            : pinDialog.mode === "unlock"
              ? "pin_unlock"
              : pinDialog.mode === "change"
                ? "pin_change"
                : "pin_remove",
          pinDialog.mode === "change"
            ? { old: value, new: next }
            : { pin: value },
        );
        setPin(status);
        const action = pinDialog.action;
        const target = pinDialog.note;
        setPinDialog(null);
        if (action && target) {
          await invoke("set_protected", { id: target.id, protected: action === "hide" }).catch(
            (error) => {
              setNotice(String(error));
              setTimeout(() => setNotice(""), 5000);
            },
          );
        }
        reload();
      } catch (error) {
        setPinError(String(error));
        invoke<PinStatus>("pin_status").then(setPin).catch(() => {});
        reload();
      }
    },
    [pinDialog, reload],
  );

  const goRail = useCallback(() => {
    restoreFocus.current = false;
    setDraft(null);
    setConflict(null);
    setMenu(null);
    void setLevel("Docked");
  }, [setLevel]);

  const recolor = useCallback(
    async (note: Note, color: string) => {
      await invoke("update_note", { note: { ...note, color } }).catch(() => {});
      reload();
    },
    [reload],
  );

  const removeNote = useCallback((note: Note) => {
    setPending(note);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pending) return;
    await invoke("delete_note", { id: pending.id }).catch(() => {});
    if (draft?.id === pending.id) setDraft(null);
    setPending(null);
    setMenu(null);
    reload();
  }, [draft, pending, reload]);

  const applyDraft = useCallback(
    (next: Note) => {
      setDraft(next);
      if (!settings.autosave || !next.id) return;
      void invoke<Note>("update_note", { note: next })
        .then((savedNote) => {
          saved.current = JSON.stringify(savedNote);
          setDraft((current) =>
            current && current.id === savedNote.id ? savedNote : current,
          );
          setConflict(null);
        })
        .catch((error) => {
          const message = String(error);
          if (message.includes("conflict")) {
            invoke<Note[]>("list_notes").then((all) => {
              const latest = all.find((note) => note.id === next.id);
              if (latest) setConflict(latest);
            });
          }
        });
    },
    [settings.autosave],
  );

  useEffect(() => {
    if (!draft || !settings.autosave) return;
    if (!draft.id) return;
    if (JSON.stringify(draft) === saved.current) return;
    const timer = setTimeout(() => applyDraft(draft), 700);
    return () => clearTimeout(timer);
  }, [applyDraft, draft, settings.autosave]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pinDialog) {
        setPinDialog(null);
        return setPinError("");
      }
      if (groupMenu) return setGroupMenu(null);
      if (confirmAction) return setConfirmAction(null);
      if (menu) return setMenu(null);
      if (pending) return setPending(null);
      if (panel) return setPanel(false);
      if (draft) return closeEditor();
      if (win.level !== "Docked") void setLevel("Docked");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeEditor, confirmAction, draft, groupMenu, menu, panel, pending, pinDialog, setLevel, win.level]);

  const visible = useMemo(() => notes.filter((note) => !note.hidden), [notes]);

  const groups = useMemo(() => {
    const found = new Set<string>();
    for (const note of visible) if (note.group.trim()) found.add(note.group.trim());
    return [...found].sort((a, b) => {
      const pinnedLeft = pinnedGroups[a] ?? 0;
      const pinnedRight = pinnedGroups[b] ?? 0;
      if (pinnedLeft !== pinnedRight) return pinnedRight - pinnedLeft;
      const left = groupOrder.indexOf(a);
      const right = groupOrder.indexOf(b);
      if (left === -1 && right === -1) return a.localeCompare(b, "pt-BR");
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    });
  }, [groupOrder, pinnedGroups, visible]);

  useEffect(() => {
    localStorage.setItem("hashimemo.tab", tab);
    if (tab !== "Todos" && !groups.includes(tab)) setTab("Todos");
  }, [groups, tab]);

  useEffect(() => {
    localStorage.setItem("hashimemo.sort", sort);
  }, [sort]);

  useEffect(() => {
    localStorage.setItem("hashimemo.pinnedGroups", JSON.stringify(pinnedGroups));
  }, [pinnedGroups]);

  const shiftGroup = useCallback(
    (name: string, delta: number) => {
      const list = [...groups];
      const index = list.indexOf(name);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      setGroupOrder(list);
      localStorage.setItem("hashimemo.groups", JSON.stringify(list));
    },
    [groups],
  );

  const pinGroup = useCallback((name: string) => {
    setPinnedGroups((current) => {
      const next = { ...current };
      if (next[name]) {
        delete next[name];
      } else {
        next[name] = Date.now();
      }
      return next;
    });
  }, []);

  const clearGroup = useCallback(
    (name: string) => {
      const targets = notes.filter((note) => note.group.trim() === name);
      setConfirmAction({
        title: `Limpar "${name}"?`,
        body: `As ${targets.length} notas do grupo continuam existindo, mas ficam sem grupo.`,
        run: () => {
          void Promise.all(
            targets.map((note) => invoke("update_note", { note: { ...note, group: "" } }).catch(() => {})),
          ).then(() => {
            setConfirmAction(null);
            reload();
          });
        },
      });
    },
    [notes, reload],
  );

  const deleteGroup = useCallback(
    (name: string) => {
      const targets = notes.filter((note) => note.group.trim() === name);
      setConfirmAction({
        title: `Excluir "${name}"?`,
        body: `Isso apaga as ${targets.length} notas deste grupo da pasta de notas.`,
        run: () => {
          void Promise.all(
            targets.map((note) => invoke("delete_note", { id: note.id }).catch(() => {})),
          ).then(() => {
            if (draft && targets.some((note) => note.id === draft.id)) setDraft(null);
            setConfirmAction(null);
            reload();
          });
        },
      });
    },
    [draft, notes, reload],
  );

  const startGroupDrag = (event: ReactPointerEvent, name: string) => {
    if (name === "Todos" || event.button !== 0) return;
    const nav = tabsRef.current;
    if (!nav) return;

    const others = () =>
      Array.from(nav.querySelectorAll<HTMLElement>("[data-group]")).filter(
        (element) => element.dataset.group !== "Todos",
      );
    const slot = (clientX: number) => {
      const list = others();
      for (let index = 0; index < list.length; index += 1) {
        const rect = list[index].getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) return index;
      }
      return list.length;
    };

    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    skipClick.current = false;

    const move = (moveEvent: PointerEvent) => {
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
        active = true;
        skipClick.current = true;
      }
      setGroupDrag({
        name,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        index: slot(moveEvent.clientX),
      });
    };

    const end = (endEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setGroupDrag(null);
      if (!active) return;
      const original = [...groups];
      const from = original.indexOf(name);
      let to = slot(endEvent.clientX);
      if (to > from) to -= 1;
      const list = original.filter((group) => group !== name);
      list.splice(Math.max(0, Math.min(to, list.length)), 0, name);
      setGroupOrder(list);
      localStorage.setItem("hashimemo.groups", JSON.stringify(list));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const startNoteDrag = (event: ReactPointerEvent, note: Note) => {
    if (event.button !== 0) return;
    const container = listRef.current;
    if (!container) return;

    const cards = () => Array.from(container.querySelectorAll<HTMLElement>("[data-note]"));
    const slot = (clientY: number) => {
      const list = cards();
      for (let index = 0; index < list.length; index += 1) {
        const rect = list[index].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return index;
      }
      return list.length;
    };

    const startY = event.clientY;
    const startX = event.clientX;
    let active = false;
    skipClick.current = false;

    const move = (moveEvent: PointerEvent) => {
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 10) return;
        active = true;
        skipClick.current = true;
      }
      setNoteDrag({
        id: note.id,
        label: note.title || "Sem título",
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        index: slot(moveEvent.clientY),
      });
    };

    const end = (endEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setNoteDrag(null);
      if (!active) return;

      const from = ordered.findIndex((item) => item.id === note.id);
      let to = slot(endEvent.clientY);
      if (to > from) to -= 1;
      const rest = ordered.filter((item) => item.id !== note.id);
      const index = Math.max(0, Math.min(to, rest.length));
      const previous = rest[index - 1];
      const next = rest[index];
      const order = !previous && !next
        ? 1
        : !previous
          ? next.order - 1
          : !next
            ? previous.order + 1
            : (previous.order + next.order) / 2;

      setSort("custom");
      void invoke("update_note", { note: { ...note, order } })
        .then(() => reload())
        .catch(() => {});
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const ordered = useMemo(() => {
    const list = tab === "Todos" ? visible : visible.filter((note) => note.group.trim() === tab);
    const byCreated = (a: Note, b: Note) => a.created.localeCompare(b.created);
    const byOrder =
      sort === "new"
        ? (a: Note, b: Note) => byCreated(b, a)
        : sort === "old"
          ? byCreated
          : (a: Note, b: Note) => a.order - b.order;
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || byOrder(a, b));
  }, [sort, tab, visible]);
  const focusMode = win.level === "Focus";
  const maxMode = win.level === "Max";
  const focused = win.level !== "Docked";
  const tabIndex = tab === "Todos" ? 0 : groups.indexOf(tab) + 1;
  const lastTab = useRef(tabIndex);
  const [slide, setSlide] = useState<"left" | "right">("right");

  useEffect(() => {
    if (tabIndex === lastTab.current) return;
    setSlide(tabIndex > lastTab.current ? "right" : "left");
    lastTab.current = tabIndex;
  }, [tabIndex]);

  const [pill, setPill] = useState<{ left: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    const element = Array.from(nav.querySelectorAll<HTMLElement>("[data-group]")).find(
      (item) => item.dataset.group === tab,
    );
    if (!element) {
      setPill(null);
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setPill({
      left: rect.left - navRect.left + nav.scrollLeft,
      width: rect.width,
      height: rect.height,
    });
  }, [groups, tab, settings.font_scale, groupDrag]);

  const editorNode = (inline: boolean) =>
    draft ? (
      <Editor
        note={draft}
        groups={groups}
        onChange={applyDraft}
        onClose={focusMode || inline ? goRail : closeEditor}
        onSave={() => void commitDraft()}
        onDelete={remove}
        onCapture={capture}
        onError={(message) => {
          setNotice(message);
          setTimeout(() => setNotice(""), 6000);
        }}
        inline={inline}
      />
    ) : null;

  const cards = (
    <>
      {ordered.map((note, index) => (
        <Fragment key={note.id}>
          {noteDrag && noteDrag.index === index && (
            <div className="h-[2px] shrink-0 rounded bg-mauve" />
          )}
          <NoteCard
            note={note}
            onOpen={() => {
              if (skipClick.current) {
                skipClick.current = false;
                return;
              }
              open(note);
            }}
            onPointerDown={(event) => startNoteDrag(event, note)}
            onContext={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ note, x: event.clientX, y: event.clientY });
            }}
          />
        </Fragment>
      ))}
      {noteDrag && noteDrag.index >= ordered.length && (
        <div className="h-[2px] shrink-0 rounded bg-mauve" />
      )}
      {ordered.length === 0 && (
        <div className="mt-4 flex flex-col items-center rounded-card border border-dashed border-surface1 px-4 py-6 text-center">
          <Kami size={72} pose="idle" className="mb-2" />
          <p className="text-sm text-subtext0">
            {tab === "Todos" ? "Nenhuma nota ainda" : `Nenhuma nota em "${tab}"`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-overlay0">
            Crie pelo botão +, ou rode{" "}
            <code className="rounded bg-surface0/70 px-1 py-0.5 text-[0.7rem] text-subtext1">
              hashimemo new "texto"
            </code>{" "}
            no terminal — o rail atualiza na hora.
          </p>
        </div>
      )}
    </>
  );

  return (
    <div
      className={`relative flex h-full flex-col bg-base text-text transition-[transform,opacity] duration-300 ${
        collapsing ? "app-collapsing" : ""
      }`}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header
        {...(!win.docked || focused ? { "data-tauri-drag-region": true } : {})}
        className="flex items-center gap-2 border-b border-surface0/70 px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <Kami size={30} pose="rosto" />
          <span className="text-sm font-semibold tracking-tight">HashiMemo</span>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => void createNote()}
            title="Nova nota"
            className="rounded-md p-1.5 text-overlay0 transition hover:bg-surface0 hover:text-green"
          >
            <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button
            onClick={() => void setLevel(win.level === "Focus" ? "Docked" : "Focus")}
            title={win.level === "Focus" ? "Voltar ao rail (Esc)" : "Foco 70%"}
            className="rounded-md p-1.5 text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            <IconExpand full={win.level === "Focus"} />
          </button>
          <button
            onClick={() => void setLevel(win.level === "Max" ? "Docked" : "Max")}
            title={win.level === "Max" ? "Voltar ao rail (Esc)" : "Maximizar"}
            className="rounded-md p-1.5 text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
            </svg>
          </button>
          <button
            onClick={() => void toggleDock()}
            disabled={busy}
            title={win.docked ? "Desencaixar janela" : "Encaixar na borda direita"}
            className={`rounded-md p-1.5 transition disabled:opacity-50 ${
              win.docked ? "bg-surface0 text-mauve" : "text-overlay0 hover:bg-surface0 hover:text-text"
            }`}
          >
            <IconDock active={win.docked} />
          </button>
          <button
            onClick={() => {
              setCollapsing(true);
              window.setTimeout(() => {
                setCollapsing(false);
                void invoke("minimize_to_bubble").catch(() => {});
              }, 250);
            }}
            title="Minimizar em bolinha"
            className="rounded-md p-1.5 text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="h-[1.05rem] w-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
          <button
            onClick={() => setPanel(true)}
            title="Configurações"
            className="rounded-md p-1.5 text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            <IconGear />
          </button>
        </div>
      </header>

      <nav
        ref={tabsRef}
        onWheel={(event) => {
          const tabs = tabsRef.current;
          if (!tabs || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          tabs.scrollLeft += event.deltaY;
        }}
        className="no-scrollbar relative flex shrink-0 gap-1 overflow-x-auto border-b border-surface0/70 px-2.5 py-1.5"
      >
        {pill && (
          <div
            className="tab-pill pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-mauve/20"
            style={{ left: pill.left, width: pill.width, height: pill.height }}
          />
        )}
        {["Todos", ...groups].map((name, index) => (
          <Fragment key={name}>
            {groupDrag && groupDrag.index === index - 1 && index > 0 && (
              <span className="h-4 w-[2px] shrink-0 self-center rounded bg-mauve" />
            )}
            <button
              data-group={name}
              onPointerDown={(event) => startGroupDrag(event, name)}
              onClick={() => {
                if (skipClick.current) {
                  skipClick.current = false;
                  return;
                }
                setTab(name);
              }}
              onContextMenu={(event) => {
                if (name === "Todos") return;
                event.preventDefault();
                event.stopPropagation();
                setGroupMenu({ name, x: event.clientX, y: event.clientY });
              }}
              className={`relative z-10 flex shrink-0 touch-none items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
                tab === name
                  ? "text-mauve"
                  : "text-overlay0 hover:bg-surface0/70 hover:text-subtext1"
              } ${groupDrag?.name === name ? "opacity-30" : ""}`}
            >
              {pinnedGroups[name] ? <span className="h-1 w-1 rounded-full bg-yellow" /> : null}
              {name}
            </button>
          </Fragment>
        ))}
        {groupDrag && groupDrag.index >= groups.length && (
          <span className="h-4 w-[2px] shrink-0 self-center rounded bg-mauve" />
        )}
      </nav>

      {focusMode ? (
        <div className="flex min-h-0 flex-1">
          <aside className="no-scrollbar w-[360px] shrink-0 overflow-y-auto border-r border-surface0/70 px-2.5 py-2.5">
            <div key={tab} ref={listRef} className={`flex flex-col gap-2 list-${slide}`}>
              {cards}
            </div>
          </aside>
          <section className="relative flex min-h-0 flex-1 flex-col">
            {draft ? (
              editorNode(true)
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
                <div className="max-w-xs">
                  <p className="text-sm text-subtext0">Nenhuma nota aberta</p>
                  <p className="mt-1 text-xs leading-relaxed text-overlay0">
                    Clique numa nota à esquerda para editar aqui.
                  </p>
                  <div className="mt-3 flex justify-center gap-2 text-xs">
                    <button
                      onClick={() => void createNote()}
                      className="rounded-md bg-surface0/70 px-2 py-1 text-subtext1 transition hover:bg-surface1"
                    >
                      nova nota
                    </button>
                    <button
                      onClick={goRail}
                      className="rounded-md bg-surface0/70 px-2 py-1 text-subtext1 transition hover:bg-surface1"
                    >
                      ← rail
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <main
          className={
            maxMode
              ? "mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-4"
              : "flex-1 overflow-y-auto px-2.5 py-2.5"
          }
        >
          {maxMode && (
            <div className="mb-3 flex items-center gap-2 text-xs text-overlay0">
              <button
                onClick={goRail}
                className="rounded bg-surface0/70 px-2 py-1 text-subtext1 transition hover:bg-surface1"
              >
                ← rail
              </button>
              <span>maximizado</span>
              {win.hyprland && <span className="text-sapphire">hyprland</span>}
            </div>
          )}
          <div key={tab} ref={listRef} className={`flex flex-col gap-2 list-${slide}`}>
            {cards}
          </div>
        </main>
      )}

      <footer className="flex items-center gap-2 border-t border-surface0/70 px-3 py-1.5 text-[0.65rem] text-overlay0">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${win.docked ? "bg-green" : "bg-yellow"}`} />
          {win.docked ? "docked" : "flutuante"}
        </span>
        <span className="text-surface2">·</span>
        <span>{ordered.length} notas</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() =>
              setSort((current) =>
                current === "new" ? "old" : current === "old" ? "custom" : "new",
              )
            }
            title={
              sort === "new"
                ? "Recentes no topo"
                : sort === "old"
                  ? "Antigas no topo"
                  : "Ordem personalizada"
            }
            className="rounded p-1 transition hover:bg-surface0 hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              {sort === "new" ? (
                <path d="M8 13V3M4 7l4-4 4 4" />
              ) : sort === "old" ? (
                <path d="M8 3v10M4 9l4 4 4-4" />
              ) : (
                <>
                  <path d="M4 5h8M4 11h8" />
                  <path d="M6 3v4M10 9v4" opacity="0.7" />
                </>
              )}
            </svg>
          </button>
          {win.monitors > 1 && (
            <button
              onClick={() => void cycleMonitor()}
              disabled={busy}
              title="Mover para a outra tela"
              className="rounded p-1 transition hover:bg-surface0 hover:text-text disabled:opacity-50"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1.5" y="3" width="8" height="10" rx="1.2" />
                <rect x="10.5" y="3" width="4" height="10" rx="1.2" />
              </svg>
            </button>
          )}
        </div>
      </footer>

      {groupDrag && (
        <div
          className="drag-ghost pointer-events-none fixed z-[60] -translate-y-1/2 rounded-full bg-mauve px-2.5 py-1 text-[0.7rem] font-medium text-crust shadow-lg"
          style={{ left: groupDrag.x + 12, top: groupDrag.y }}
        >
          {groupDrag.name}
        </div>
      )}

      {noteDrag && (
        <div
          className="drag-ghost pointer-events-none fixed z-[60] max-w-[220px] -translate-y-1/2 truncate rounded-md border border-mauve/60 bg-mantle/95 px-2 py-1 text-xs font-medium text-text shadow-lg"
          style={{ left: Math.min(noteDrag.x + 14, window.innerWidth - 230), top: noteDrag.y }}
        >
          {noteDrag.label}
        </div>
      )}

      {draft && !focusMode && (
        <>
          {editorNode(false)}
          {notice && (
            <div className="absolute inset-x-0 bottom-0 z-30 border-t border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
              {notice}
            </div>
          )}
          {conflict && (
            <div className="absolute inset-x-0 bottom-0 z-30 border-t border-yellow/40 bg-yellow/10 px-3 py-2 text-xs text-yellow">
              Alterado fora do app.
              <button
                className="ml-2 rounded bg-surface0 px-2 py-0.5 text-text"
                onClick={() => {
                  setDraft(conflict);
                  saved.current = JSON.stringify(conflict);
                  setConflict(null);
                }}
              >
                carregar versão do arquivo
              </button>
            </div>
          )}
        </>
      )}

      {menu && (
        <NoteMenu
          note={menu.note}
          x={menu.x}
          y={menu.y}
          onEdit={() => open(menu.note)}
          onFocus={() => open(menu.note, true)}
          onPin={() => void togglePin(menu.note)}
          onHide={() => void toggleHidden(menu.note)}
          onColor={(color) => void recolor(menu.note, color)}
          onDelete={() => void removeNote(menu.note)}
          onClose={() => setMenu(null)}
        />
      )}

      {panel && (
        <SettingsPanel
          settings={settings}
          notesPath={notesPath}
          hidden={notes.filter((note) => note.hidden)}
          pin={pin}
          onChange={persist}
          onUnhide={(note) => void toggleHidden(note)}
          onPin={(mode) => setPinDialog({ mode })}
          onLock={() => void lockNotes()}
          onClose={() => setPanel(false)}
        />
      )}

      {groupMenu && (
        <GroupMenu
          name={groupMenu.name}
          count={notes.filter((note) => note.group.trim() === groupMenu.name).length}
          pinned={Boolean(pinnedGroups[groupMenu.name])}
          x={groupMenu.x}
          y={groupMenu.y}
          onPin={() => pinGroup(groupMenu.name)}
          onMove={(delta) => shiftGroup(groupMenu.name, delta)}
          onClear={() => clearGroup(groupMenu.name)}
          onDelete={() => deleteGroup(groupMenu.name)}
          onClose={() => setGroupMenu(null)}
        />
      )}

      {confirmAction && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-crust/70 px-4 backdrop-blur-sm">
          <div className="w-full rounded-xl border border-surface1/70 bg-mantle p-4 shadow-2xl pop-enter">
            <p className="text-sm font-semibold">{confirmAction.title}</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-subtext0">
              {confirmAction.body}
            </p>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded-md px-2.5 py-1.5 text-subtext1 transition hover:bg-surface0"
              >
                cancelar
              </button>
              <button
                onClick={confirmAction.run}
                className="rounded-md bg-red/90 px-2.5 py-1.5 font-medium text-crust transition hover:bg-red"
              >
                confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {pinDialog && (
        <PinDialog
          mode={pinDialog.mode}
          error={pinError}
          onSubmit={(value, next) => void submitPin(value, next)}
          onClose={() => {
            setPinDialog(null);
            setPinError("");
          }}
        />
      )}

      {pending && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-crust/70 px-4 backdrop-blur-sm">
          <div className="w-full rounded-xl border border-surface1/70 bg-mantle p-4 shadow-2xl pop-enter">
            <p className="text-sm font-semibold">Excluir nota?</p>
            <p className="mt-1 break-words text-xs leading-relaxed text-subtext0">
              {pending.title || "Sem título"} — o arquivo é removido da pasta de notas.
            </p>
            <div className="mt-3 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setPending(null)}
                className="rounded-md px-2.5 py-1.5 text-subtext1 transition hover:bg-surface0"
              >
                cancelar
              </button>
              <button
                onClick={() => void confirmDelete()}
                className="rounded-md bg-red/90 px-2.5 py-1.5 font-medium text-crust transition hover:bg-red"
              >
                excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
