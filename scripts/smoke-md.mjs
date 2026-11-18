import { Window } from "happy-dom";

const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
globalThis.HTMLElement = win.HTMLElement;
globalThis.Node = win.Node;
globalThis.getComputedStyle = win.getComputedStyle.bind(win);
globalThis.DOMParser = win.DOMParser;

const { Editor } = await import("@tiptap/core");
const StarterKit = (await import("@tiptap/starter-kit")).default;
const Image = (await import("@tiptap/extension-image")).default;
const { Markdown } = await import("tiptap-markdown");

const source = `## Título

- item **forte**
- item <u>sublinhado</u>

> capturado de: notepad — arquivo.txt

![notepad](http://asset.localhost/C%3A/x.png)
`;

const editor = new Editor({
  extensions: [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
    Image.configure({ inline: false, allowBase64: false }),
    Markdown.configure({ html: true, tightLists: true, linkify: false, breaks: false }),
  ],
  content: source,
});

const out = editor.storage.markdown.getMarkdown();
console.log("--- markdown de volta ---");
console.log(out);
console.log("--- checagens ---");
console.log("heading:", out.includes("## Título"));
console.log("negrito:", out.includes("**forte**"));
console.log("sublinhado:", out.toLowerCase().includes("<u>"));
console.log("imagem:", out.includes("![notepad](http://asset.localhost"));
editor.destroy();
