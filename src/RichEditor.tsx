//! Editor TipTap: markdown ao redor, toolbar, atalhos e inserção de capturas/colagens.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Paragraph from "@tiptap/extension-paragraph";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "tiptap-markdown";

export type Capture = { src: string; alt: string; source: string };

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  onCapture: () => Promise<Capture | null>;
  onError?: (message: string) => void;
  onRemind?: () => void;
  reminding?: boolean;
};

function Button({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-xs transition hover:bg-surface0 ${
        active ? "bg-surface0 text-mauve" : "text-overlay0 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

type MenuAction = {
  label: string;
  hint?: string;
  active?: boolean;
  run: () => void;
};

// Linha em branco: markdown puro descarta parágrafos vazios. Um parágrafo só de
// quebras vira `<br>` no arquivo e volta igual — o Enter duplo sobrevive ao save.
const BlankParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (text: string) => void;
            renderInline: (node: unknown) => void;
            closeBlock: (node: unknown) => void;
          },
          node: any,
        ) {
          const onlyBreaks =
            node.childCount > 0 &&
            Array.from({ length: node.childCount }).every(
              (_, index) => node.child(index).type.name === "hardBreak",
            );
          if (onlyBreaks) {
            state.write("<br>".repeat(node.childCount));
            state.closeBlock(node);
            return;
          }
          state.renderInline(node);
          state.closeBlock(node);
        },
      },
    };
  },
});

function ContextMenu({
  x,
  y,
  groups,
  onClose,
}: {
  x: number;
  y: number;
  groups: MenuAction[][];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 w-56 rounded-lg border border-surface1/80 bg-mantle p-1 text-xs shadow-2xl"
    >
      {groups.map((group, index) => (
        <div key={index} className={index ? "mt-1 border-t border-surface0/70 pt-1" : ""}>
          {group.map((action) => (
            <button
              key={action.label}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                action.run();
                onClose();
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition hover:bg-surface0 ${
                action.active ? "text-mauve" : "text-subtext1 hover:text-text"
              }`}
            >
              <span className="truncate">{action.label}</span>
              {action.hint && (
                <span className="ml-auto shrink-0 text-[0.6rem] text-overlay0">{action.hint}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function RichEditor({ value, onChange, onCapture, onError, onRemind, reminding }: Props) {
  const emit = useRef(value);
  const change = useRef(onChange);
  const capture = useRef(onCapture);
  const fail = useRef(onError);
  const [, force] = useState(0);
  const api = useRef<TiptapEditor | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  change.current = onChange;
  capture.current = onCapture;
  fail.current = onError;

  const enableDrag = (instance: TiptapEditor) => {
    instance.view.dom.querySelectorAll("img").forEach((img) => {
      (img as HTMLImageElement).draggable = true;
    });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
        paragraph: false,
      }),
      BlankParagraph,
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // breaks: true — quebra simples de linha é conteúdo, não espaço. Sem isso, nota escrita
      // fora do app (CLI/agente) perde as quebras no round-trip markdown -> editor -> markdown.
      Markdown.configure({ html: true, tightLists: true, linkify: false, breaks: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "hashi-prose flex-1 overflow-y-auto px-2.5 py-2 text-sm leading-relaxed outline-none",
      },
      // Atalhos no próprio ProseMirror: roda antes do keymap e do handler da janela.
      handleKeyDown: (_view, event) => {
        const instance = api.current;
        if (!instance) return false;
        // Enter num parágrafo vazio (que não é o primeiro bloco) cria a linha em branco
        // de verdade: hardBreak no parágrafo, que o serializador grava como <br>.
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey
        ) {
          const { $from } = instance.state.selection;
          const parent = $from.parent;
          if (
            $from.depth === 1 &&
            parent.type.name === "paragraph" &&
            parent.textContent.trim() === "" &&
            $from.index(0) > 0
          ) {
            instance.chain().focus().setHardBreak().run();
            event.preventDefault();
            return true;
          }
          return false;
        }
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
        const key = event.key.toLowerCase();
        const chain = () => instance.chain().focus();
        if (key === "b") chain().toggleBold().run();
        else if (key === "i") chain().toggleItalic().run();
        else if (key === "u") chain().toggleUnderline().run();
        else if (event.shiftKey && key === "x") chain().toggleStrike().run();
        else if (event.shiftKey && key === "8") chain().toggleBulletList().run();
        else if (event.shiftKey && key === "7") chain().toggleOrderedList().run();
        else if (event.shiftKey && key === "9") chain().toggleTaskList().run();
        else return false;
        event.preventDefault();
        return true;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        void (async () => {
          for (const file of files) {
            try {
              const data = base64(await file.arrayBuffer());
              const saved = await invoke<string>("save_pasted_image", { data });
              const node = view.state.schema.nodes.image.create({
                src: convertFileSrc(saved),
                alt: file.name || "imagem",
              });
              view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            } catch (error) {
              fail.current?.(`falha ao colar a imagem: ${String(error)}`);
            }
          }
        })();
        return true;
      },
    },
    onCreate: ({ editor: instance }) => {
      api.current = instance;
      enableDrag(instance);
    },
    onUpdate: ({ editor: instance }) => {
      enableDrag(instance);
      const markdown = (instance.storage as unknown as { markdown: { getMarkdown(): string } })
        .markdown.getMarkdown();
      emit.current = markdown;
      change.current(markdown);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const tick = () => force((count) => count + 1);
    editor.on("transaction", tick);
    editor.on("selectionUpdate", tick);
    return () => {
      editor.off("transaction", tick);
      editor.off("selectionUpdate", tick);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || value === emit.current) return;
    emit.current = value;
    if (editor.isFocused) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const shot = async () => {
    if (!editor) return;
    try {
      const captured = await capture.current();
      if (!captured) return;
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "image", attrs: { src: captured.src, alt: captured.alt } },
          {
            type: "blockquote",
            content: [
              { type: "paragraph", content: [{ type: "text", text: `capturado de: ${captured.source}` }] },
            ],
          },
        ])
        .run();
      enableDrag(editor);
      if (!editor.getHTML().includes("<img")) {
        fail.current?.("captura gerada, mas o editor não aceitou a imagem — use o botão md para ver o markdown");
      }
    } catch (error) {
      fail.current?.(`falha ao inserir a captura: ${String(error)}`);
    }
  };

  const run = (fn: (instance: TiptapEditor) => void) => {
    if (!editor) return;
    fn(editor);
    force((count) => count + 1);
  };

  const clip = async (cut: boolean) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fail.current?.("não foi possível escrever na área de transferência");
      return;
    }
    if (cut) editor.chain().focus().deleteSelection().run();
  };

  const paste = async () => {
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const content = text
        .split(/\r?\n/)
        .map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" }));
      editor.chain().focus().insertContent(content).run();
    } catch {
      fail.current?.("não foi possível ler a área de transferência");
    }
  };

  const groups: MenuAction[][] = editor
    ? [
        [
          { label: "Recortar", hint: "Ctrl+X", run: () => void clip(true) },
          { label: "Copiar", hint: "Ctrl+C", run: () => void clip(false) },
          { label: "Colar", hint: "Ctrl+V", run: () => void paste() },
          { label: "Selecionar tudo", hint: "Ctrl+A", run: () => run((e) => e.chain().focus().selectAll().run()) },
        ],
        [
          { label: "Negrito", hint: "Ctrl+B", active: editor.isActive("bold"), run: () => run((e) => e.chain().focus().toggleBold().run()) },
          { label: "Itálico", hint: "Ctrl+I", active: editor.isActive("italic"), run: () => run((e) => e.chain().focus().toggleItalic().run()) },
          { label: "Sublinhado", hint: "Ctrl+U", active: editor.isActive("underline"), run: () => run((e) => e.chain().focus().toggleUnderline().run()) },
          { label: "Tachado", hint: "Ctrl+Shift+X", active: editor.isActive("strike"), run: () => run((e) => e.chain().focus().toggleStrike().run()) },
          { label: "Código", hint: "Ctrl+E", active: editor.isActive("code"), run: () => run((e) => e.chain().focus().toggleCode().run()) },
        ],
        [
          { label: "Título", active: editor.isActive("heading", { level: 2 }), run: () => run((e) => e.chain().focus().toggleHeading({ level: 2 }).run()) },
          { label: "Lista com marcadores", hint: "Ctrl+Shift+8", active: editor.isActive("bulletList"), run: () => run((e) => e.chain().focus().toggleBulletList().run()) },
          { label: "Lista numerada", hint: "Ctrl+Shift+7", active: editor.isActive("orderedList"), run: () => run((e) => e.chain().focus().toggleOrderedList().run()) },
          { label: "Lista de tarefas", hint: "Ctrl+Shift+9", active: editor.isActive("taskList"), run: () => run((e) => e.chain().focus().toggleTaskList().run()) },
          { label: "Citação", run: () => run((e) => e.chain().focus().toggleBlockquote().run()) },
        ],
      ]
    : [];

  return (
    <>
      <div className="mx-3 flex items-center gap-0.5 rounded-md border border-surface0/60 bg-mantle/60 px-1 py-0.5">
        <Button active={editor?.isActive("bold")} title="Negrito (Ctrl+B)" onClick={() => run((e) => e.chain().focus().toggleBold().run())}>
          <span className="font-semibold">B</span>
        </Button>
        <Button active={editor?.isActive("italic")} title="Itálico (Ctrl+I)" onClick={() => run((e) => e.chain().focus().toggleItalic().run())}>
          <span className="italic">I</span>
        </Button>
        <Button active={editor?.isActive("strike")} title="Tachado (Ctrl+Shift+X)" onClick={() => run((e) => e.chain().focus().toggleStrike().run())}>
          <span className="line-through">S</span>
        </Button>
        <Button
          active={editor?.isActive("underline")}
          title="Sublinhado (Ctrl+U)"
          onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}
        >
          <span className="underline">U</span>
        </Button>
        <Button active={editor?.isActive("code")} title="Código" onClick={() => run((e) => e.chain().focus().toggleCode().run())}>
          {"</>"}
        </Button>
        <Button
          active={editor?.isActive("bulletList")}
          title="Lista com marcadores (Ctrl+Shift+8)"
          onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
        >
          •
        </Button>
        <Button
          active={editor?.isActive("orderedList")}
          title="Lista numerada (Ctrl+Shift+7)"
          onClick={() => run((e) => e.chain().focus().toggleOrderedList().run())}
        >
          1.
        </Button>
        <Button
          active={editor?.isActive("taskList")}
          title="Lista de tarefas (Ctrl+Shift+9)"
          onClick={() => run((e) => e.chain().focus().toggleTaskList().run())}
        >
          ☑
        </Button>
        <Button
          active={editor?.isActive("heading", { level: 2 })}
          title="Título"
          onClick={() => run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}
        >
          #
        </Button>
        <Button title="Capturar janela ativa" onClick={() => void shot()}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="1.5" y="4" width="13" height="9" rx="2" />
            <circle cx="8" cy="8.5" r="2.4" />
            <path d="M5.5 4l.8-1.5h3.4L10.5 4" />
          </svg>
        </Button>
        {onRemind && (
          <Button active={reminding} title="Lembrete" onClick={onRemind}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 7a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7zM6.5 13a1.5 1.5 0 0 0 3 0" />
            </svg>
          </Button>
        )}
      </div>

      <div
        className="mx-3 flex min-h-0 flex-1 flex-col rounded-md border border-surface0/60 bg-mantle/60"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <EditorContent editor={editor} className="hashi-editor flex min-h-0 flex-1 flex-col" />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} groups={groups} onClose={() => setMenu(null)} />}
    </>
  );
}
