import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Md } from "./md";

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
  remind_at: string;
  created: string;
  updated: string;
  mtime: number;
};

const THEMES = [
  { id: "mocha", label: "Catppuccin Mocha" },
  { id: "latte", label: "Catppuccin Latte (claro)" },
  { id: "breeze", label: "Breeze Dark" },
];

const COLORS = ["mauve", "blue", "green", "peach", "red", "yellow", "teal", "pink"];

const ACCENT: Record<string, string> = {
  mauve: "var(--color-mauve)",
  blue: "var(--color-blue)",
  green: "var(--color-green)",
  peach: "var(--color-peach)",
  red: "var(--color-red)",
  yellow: "var(--color-yellow)",
  teal: "var(--color-teal)",
  pink: "var(--color-pink)",
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

function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="mark" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-mauve)" />
          <stop offset="1" stopColor="var(--color-blue)" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="url(#mark)" />
      <g fill="var(--color-crust)">
        <rect x="6.5" y="9" width="9" height="1.9" rx="0.95" />
        <rect x="6.5" y="13.6" width="11.5" height="1.9" rx="0.95" />
        <rect x="6.5" y="18.2" width="7" height="1.9" rx="0.95" />
        <rect x="6.5" y="22.8" width="4.5" height="1.9" rx="0.95" />
      </g>
      <rect x="21" y="9" width="3.4" height="15.8" rx="1.7" fill="var(--color-crust)" opacity="0.8" />
    </svg>
  );
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
}: {
  note: Note;
  onOpen: () => void;
  onContext: (event: MouseEvent) => void;
}) {
  const accent = ACCENT[note.color] ?? "var(--color-mauve)";
  const preview = note.body.replace(/^#+ .*\n/, "").trim();
  return (
    <article
      onClick={onOpen}
      onContextMenu={onContext}
      className="rail-card group relative cursor-pointer overflow-hidden px-3 py-2.5"
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
        <span className="ml-auto tabular-nums">{relative(note.updated)}</span>
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

function Editor({
  note,
  onChange,
  onClose,
  onDelete,
  onCapture,
  indent = false,
}: {
  note: Note;
  onChange: (next: Note) => void;
  onClose: () => void;
  onDelete: () => void;
  onCapture: () => void;
  indent?: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);

  const wrap = (before: string, after = before) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const selected = value.slice(start, end);
    onChange({ ...note, body: value.slice(0, start) + before + selected + after + value.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };

  const bullet = () => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: start, value } = el;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    onChange({ ...note, body: `${value.slice(0, lineStart)}- ${value.slice(lineStart)}` });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 2, start + 2);
    });
  };

  const tool = (label: string, title: string, run: () => void, wide = false) => (
    <button
      key={title}
      title={title}
      onClick={run}
      className={`rounded px-1.5 py-0.5 text-xs text-overlay0 transition hover:bg-surface0 hover:text-text ${
        wide ? "font-semibold" : ""
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className={`absolute inset-y-0 right-0 z-20 flex flex-col bg-base editor-enter ${
        indent ? "left-[360px] border-l border-surface0/70" : "left-0"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-surface0/70 px-3 py-2">
        <button
          onClick={onClose}
          className="rounded bg-surface0/70 px-2 py-1 text-xs text-subtext1 transition hover:bg-surface1"
        >
          ← voltar
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
          onClick={() => setRemindOpen((value) => !value)}
          title="Lembrete"
          className={`rounded p-1.5 transition hover:bg-surface0 ${
            note.remind_at ? "text-yellow" : "text-overlay0"
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M4 7a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7zM6.5 13a1.5 1.5 0 0 0 3 0" />
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
          <input
            value={note.group}
            onChange={(event) => onChange({ ...note, group: event.target.value })}
            placeholder="grupo"
            className="w-32 rounded-md border border-surface0/60 bg-mantle/60 px-2 py-1 text-xs outline-none transition focus:border-mauve/70"
          />
          <div className="ml-auto flex items-center gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => onChange({ ...note, color })}
                title={color}
                className={`h-4 w-4 rounded-full transition ${
                  note.color === color ? "ring-2 ring-text/70 ring-offset-1 ring-offset-base" : "opacity-60 hover:opacity-100"
                }`}
                style={{ background: ACCENT[color] }}
              />
            ))}
          </div>
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

        <div className="mx-3 flex items-center gap-0.5 rounded-md border border-surface0/60 bg-mantle/60 px-1 py-0.5">
          {tool("B", "Negrito", () => wrap("**"), true)}
          {tool("I", "Itálico", () => wrap("*"), true)}
          {tool("S", "Tachado", () => wrap("~~"), true)}
          {tool("U", "Sublinhado", () => wrap("<u>", "</u>"), true)}
          {tool("</>", "Código", () => wrap("`"))}
          {tool("•", "Lista", bullet)}
          {tool("#", "Título", () => wrap("## ", ""))}
          <button
            onClick={onCapture}
            title="Capturar janela ativa"
            className="rounded px-1.5 py-0.5 text-overlay0 transition hover:bg-surface0 hover:text-text"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1.5" y="4" width="13" height="9" rx="2" />
              <circle cx="8" cy="8.5" r="2.4" />
              <path d="M5.5 4l.8-1.5h3.4L10.5 4" />
            </svg>
          </button>
          <button
            onClick={() => setPreview((value) => !value)}
            title={preview ? "Editar" : "Pré-visualizar Markdown"}
            className={`ml-auto rounded px-1.5 py-0.5 text-xs transition hover:bg-surface0 ${
              preview ? "text-mauve" : "text-overlay0 hover:text-text"
            }`}
          >
            {preview ? "editar" : "ver"}
          </button>
        </div>

        {preview ? (
          <div className="mx-3 flex-1 overflow-y-auto rounded-md border border-surface0/60 bg-mantle/60 px-2.5 py-2 text-sm leading-relaxed list-enter">
            <Md text={note.body} />
          </div>
        ) : (
          <textarea
            ref={bodyRef}
            value={note.body}
            onChange={(event) => onChange({ ...note, body: event.target.value })}
            placeholder="Escreva em Markdown…"
            spellCheck={false}
            className="mx-3 flex-1 resize-none rounded-md border border-surface0/60 bg-mantle/60 px-2.5 py-2 text-sm leading-relaxed outline-none transition focus:border-mauve/70"
          />
        )}
        <div className="mx-3 flex items-center justify-between text-[0.6rem] text-overlay0">
          <span className="tabular-nums">{note.id.slice(0, 8)}</span>
          <span>autosave</span>
        </div>
      </div>
    </div>
  );
}

const OPENCODE_HELP = `Skill \`hashimemo\` em \`~/.config/opencode/skills/hashimemo/SKILL.md\` e regra no \`AGENTS.md\` global: toda sessão sabe que as notas ficam neste rail e como ler/gravar.

Comandos de sessão: \`/nota <texto>\` grava no grupo OpenCode; \`/notas [termo]\` lista ou busca.

CLI no PATH: \`hashimemo list|search|read|edit|context|new\`. Grupo OpenCode = aba no rail.`;

function SettingsPanel({
  settings,
  notesPath,
  hidden,
  onChange,
  onUnhide,
  onClose,
}: {
  settings: Settings;
  notesPath: string;
  hidden: Note[];
  onChange: (next: Settings) => void;
  onUnhide: (note: Note) => void;
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
          </div>
          <p className="mt-1.5 break-all text-[0.65rem] text-overlay0">
            vazio = padrão (~/HashiMemo/notes) · atual: {notesPath}
          </p>
        </section>

        <section className="border-t border-surface0/60 pt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-subtext1">Notas ocultas</span>
            <span className="text-xs text-overlay0">{hidden.length}</span>
          </div>
          {hidden.length === 0 ? (
            <p className="text-xs text-overlay0">
              Nenhuma. Use o botão direito na nota → Ocultar.
            </p>
          ) : (
            <ul className="space-y-1">
              {hidden.map((note) => (
                <li key={note.id} className="flex items-center gap-2 text-xs">
                  <span className="truncate text-subtext0">{note.title || "Sem título"}</span>
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
        </section>

        <section className="border-t border-surface0/60 pt-4">
          <p className="mb-2 text-subtext1">Integração OpenCode</p>
          <Md text={OPENCODE_HELP} className="rounded-md border border-surface0/60 bg-base/60 px-2.5 py-2 text-xs leading-relaxed text-subtext0" />
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
        </section>
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
  const [pending, setPending] = useState<Note | null>(null);
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("hashimemo.groups");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const saved = useRef<string>("");
  const tabsRef = useRef<HTMLElement>(null);

  const reload = useCallback(() => {
    invoke<Note[]>("list_notes").then(setNotes).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<WindowState>("window_state").then(setWin).catch(() => {});
    invoke<Settings>("get_settings").then(setSettings).catch(() => {});
    invoke<string>("notes_dir").then(setNotesPath).catch(() => {});
    reload();
    const unlisten = listen("notes:changed", () => reload());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [reload]);

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(settings.font_scale / 100));
  }, [settings.font_scale]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme || "mocha";
  }, [settings.theme]);

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

  const open = useCallback(
    (note: Note, expand = false) => {
      saved.current = JSON.stringify(note);
      setDraft(note);
      setConflict(null);
      if (expand && win.level === "Docked") void setLevel("Focus");
    },
    [setLevel, win.level],
  );

  const closeEditor = useCallback(() => {
    setDraft(null);
    setConflict(null);
    setNotes((current) => current.map((note) => (draft && note.id === draft.id ? draft : note)));
  }, [draft]);

  const createNote = useCallback(async () => {
    try {
      const note = await invoke<Note>("create_note", {
        title: "",
        body: "",
        color: "mauve",
        group: "",
      });
      reload();
      open(note, true);
    } catch {
      /* watcher reloads on next change */
    }
  }, [open, reload]);

  const remove = useCallback(async () => {
    if (!draft) return;
    await invoke("delete_note", { id: draft.id }).catch(() => {});
    setDraft(null);
    reload();
  }, [draft, reload]);

  const capture = useCallback(async () => {
    if (!draft) return;
    try {
      const shot = await invoke<{
        path: string;
        title: string;
        app: string;
        url: string | null;
      }>("capture_window");
      const label = [shot.app, shot.title].filter(Boolean).join(" — ") || "captura";
      const source = shot.url ? `${label} (${shot.url})` : label;
      const block = `\n\n![${label}](${convertFileSrc(shot.path)})\n> capturado de: ${source}\n`;
      setDraft((current) => (current ? { ...current, body: current.body.trimEnd() + block } : current));
    } catch (error) {
      setNotice(String(error));
      setTimeout(() => setNotice(""), 4000);
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
      await invoke("update_note", { note: { ...note, hidden: !note.hidden } }).catch(() => {});
      reload();
    },
    [reload],
  );

  const goRail = useCallback(() => {
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
    [],
  );

  useEffect(() => {
    if (!draft) return;
    if (JSON.stringify(draft) === saved.current) return;
    const timer = setTimeout(() => applyDraft(draft), 700);
    return () => clearTimeout(timer);
  }, [applyDraft, draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) return setMenu(null);
      if (pending) return setPending(null);
      if (panel) return setPanel(false);
      if (draft) return closeEditor();
      if (win.level !== "Docked") void setLevel("Docked");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeEditor, draft, menu, panel, pending, setLevel, win.level]);

  const visible = useMemo(() => notes.filter((note) => !note.hidden), [notes]);

  const groups = useMemo(() => {
    const found = new Set<string>();
    for (const note of visible) if (note.group.trim()) found.add(note.group.trim());
    return [...found].sort((a, b) => {
      const left = groupOrder.indexOf(a);
      const right = groupOrder.indexOf(b);
      if (left === -1 && right === -1) return a.localeCompare(b, "pt-BR");
      if (left === -1) return 1;
      if (right === -1) return -1;
      return left - right;
    });
  }, [groupOrder, visible]);

  useEffect(() => {
    localStorage.setItem("hashimemo.tab", tab);
    if (tab !== "Todos" && !groups.includes(tab)) setTab("Todos");
  }, [groups, tab]);

  const moveGroup = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      const current = [...groups];
      const next = current.filter((name) => name !== from);
      next.splice(next.indexOf(to), 0, from);
      setGroupOrder(next);
      localStorage.setItem("hashimemo.groups", JSON.stringify(next));
    },
    [groups],
  );

  const ordered = useMemo(
    () => (tab === "Todos" ? visible : visible.filter((note) => note.group.trim() === tab)),
    [tab, visible],
  );
  const railBlocked = win.level !== "Docked" && Boolean(draft);
  const focused = win.level !== "Docked";

  return (
    <div
      className="relative flex h-full flex-col bg-base text-text"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header
        {...(!win.docked || focused ? { "data-tauri-drag-region": true } : {})}
        className="flex items-center gap-2 border-b border-surface0/70 px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <Mark />
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
        className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-surface0/70 px-2.5 py-1.5"
      >
        {["Todos", ...groups].map((name) => (
          <button
            key={name}
            draggable={name !== "Todos"}
            onDragStart={() => setDragGroup(name)}
            onDragEnd={() => setDragGroup(null)}
            onDragOver={(event) => {
              if (dragGroup && dragGroup !== name && name !== "Todos") event.preventDefault();
            }}
            onDrop={() => {
              if (dragGroup && name !== "Todos") moveGroup(dragGroup, name);
              setDragGroup(null);
            }}
            onClick={() => setTab(name)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition ${
              tab === name
                ? "bg-mauve/20 text-mauve"
                : "text-overlay0 hover:bg-surface0/70 hover:text-subtext1"
            } ${dragGroup === name ? "opacity-40" : ""} ${
              name !== "Todos" ? "cursor-grab active:cursor-grabbing" : ""
            }`}
          >
            {name}
          </button>
        ))}
      </nav>

      <main
        className={
          railBlocked
            ? "w-[360px] shrink-0 overflow-hidden px-2.5 py-2.5 opacity-45 pointer-events-none"
            : focused
              ? "mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-4"
              : "flex-1 overflow-y-auto px-2.5 py-2.5"
        }
      >
        {focused && !railBlocked && (
          <div className="mb-3 flex items-center gap-2 text-xs text-overlay0">
            <button
              onClick={goRail}
              className="rounded bg-surface0/70 px-2 py-1 text-subtext1 transition hover:bg-surface1"
            >
              ← rail
            </button>
            <span>{win.level === "Max" ? "maximizado" : "foco 70%"}</span>
            {win.hyprland && <span className="text-sapphire">hyprland</span>}
          </div>
        )}

        <div key={tab} className={`flex flex-col gap-2 list-enter ${focused ? "" : ""}`}>
          {ordered.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => open(note)}
              onContext={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({ note, x: event.clientX, y: event.clientY });
              }}
            />
          ))}
          {ordered.length === 0 && (
            <div className="mt-6 rounded-card border border-dashed border-surface1 px-4 py-6 text-center">
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
        </div>
      </main>

      <footer className="flex items-center gap-2 border-t border-surface0/70 px-3 py-1.5 text-[0.65rem] text-overlay0">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${win.docked ? "bg-green" : "bg-yellow"}`} />
          {win.docked ? "docked" : "flutuante"}
        </span>
        <span className="text-surface2">·</span>
        <span>{ordered.length} notas</span>
        {win.monitors > 1 && (
          <button
            onClick={() => void cycleMonitor()}
            disabled={busy}
            title="Mover para a outra tela"
            className="flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-surface0 hover:text-text disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.5" y="3" width="8" height="10" rx="1.2" />
              <rect x="10.5" y="3" width="4" height="10" rx="1.2" />
            </svg>
            tela
          </button>
        )}
        <span className="ml-auto tabular-nums">v0.2.1</span>
      </footer>

      {draft && (
        <>
          <Editor
            note={draft}
            onChange={applyDraft}
            onClose={closeEditor}
            onDelete={remove}
            onCapture={() => void capture()}
            indent={railBlocked}
          />
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
          onChange={persist}
          onUnhide={(note) => void toggleHidden(note)}
          onClose={() => setPanel(false)}
        />
      )}

      {pending && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-crust/70 px-4 backdrop-blur-sm">
          <div className="w-full rounded-xl border border-surface1/70 bg-mantle p-4 shadow-2xl level-enter">
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
