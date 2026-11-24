//! Editor TipTap: markdown ao redor, toolbar, atalhos e inserção de capturas/colagens.
import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
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

export function RichEditor({ value, onChange, onCapture, onError, onRemind, reminding }: Props) {
  const emit = useRef(value);
  const change = useRef(onChange);
  const capture = useRef(onCapture);
  const fail = useRef(onError);
  const [, force] = useState(0);
  const api = useRef<TiptapEditor | null>(null);

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
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Image.configure({ inline: false, allowBase64: false }),
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
        if (!instance || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
        const key = event.key.toLowerCase();
        const chain = () => instance.chain().focus();
        if (key === "b") chain().toggleBold().run();
        else if (key === "i") chain().toggleItalic().run();
        else if (key === "u") chain().toggleUnderline().run();
        else if (event.shiftKey && key === "x") chain().toggleStrike().run();
        else if (event.shiftKey && key === "8") chain().toggleBulletList().run();
        else if (event.shiftKey && key === "7") chain().toggleOrderedList().run();
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

      <div className="mx-3 flex min-h-0 flex-1 flex-col rounded-md border border-surface0/60 bg-mantle/60">
        <EditorContent editor={editor} className="hashi-editor flex min-h-0 flex-1 flex-col" />
      </div>
    </>
  );
}
