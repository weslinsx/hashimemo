import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";

export type Capture = { src: string; alt: string; source: string };

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  onCapture: () => Promise<Capture | null>;
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

export function RichEditor({ value, onChange, onCapture }: Props) {
  const emit = useRef(value);
  const change = useRef(onChange);
  const capture = useRef(onCapture);
  const [, force] = useState(0);

  change.current = onChange;
  capture.current = onCapture;

  const enableDrag = (instance: TiptapEditor) => {
    instance.view.dom.querySelectorAll("img").forEach((img) => {
      (img as HTMLImageElement).draggable = true;
    });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Image.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: true, tightLists: true, linkify: false, breaks: false }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "hashi-prose flex-1 overflow-y-auto px-2.5 py-2 text-sm leading-relaxed outline-none",
      },
    },
    onCreate: ({ editor: instance }) => enableDrag(instance),
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
    const captured = await capture.current();
    if (!captured) return;
    editor
      .chain()
      .focus()
      .setImage({ src: captured.src, alt: captured.alt })
      .insertContent({
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: `capturado de: ${captured.source}` }] }],
      })
      .run();
  };

  const run = (fn: (instance: TiptapEditor) => void) => {
    if (!editor) return;
    fn(editor);
    force((count) => count + 1);
  };

  return (
    <>
      <div className="mx-3 flex items-center gap-0.5 rounded-md border border-surface0/60 bg-mantle/60 px-1 py-0.5">
        <Button active={editor?.isActive("bold")} title="Negrito" onClick={() => run((e) => e.chain().focus().toggleBold().run())}>
          <span className="font-semibold">B</span>
        </Button>
        <Button active={editor?.isActive("italic")} title="Itálico" onClick={() => run((e) => e.chain().focus().toggleItalic().run())}>
          <span className="italic">I</span>
        </Button>
        <Button active={editor?.isActive("strike")} title="Tachado" onClick={() => run((e) => e.chain().focus().toggleStrike().run())}>
          <span className="line-through">S</span>
        </Button>
        <Button
          active={editor?.isActive("underline")}
          title="Sublinhado"
          onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}
        >
          <span className="underline">U</span>
        </Button>
        <Button active={editor?.isActive("code")} title="Código" onClick={() => run((e) => e.chain().focus().toggleCode().run())}>
          {"</>"}
        </Button>
        <Button
          active={editor?.isActive("bulletList")}
          title="Lista"
          onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
        >
          •
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
      </div>

      <div className="mx-3 flex min-h-0 flex-1 flex-col rounded-md border border-surface0/60 bg-mantle/60">
        <EditorContent editor={editor} className="hashi-editor flex min-h-0 flex-1 flex-col" />
      </div>
    </>
  );
}
