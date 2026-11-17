import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|!\[[^\]\n]*\]\([^)\s]+\)|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;

function link(url: string, label: string, key: string) {
  return (
    <a
      key={key}
      href={url}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openUrl(url).catch(() => {});
      }}
      className="text-blue underline decoration-blue/40 underline-offset-2 hover:decoration-blue"
    >
      {label}
    </a>
  );
}

export function inline(text: string, key = "i"): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const id = `${key}-${index}`;
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={id}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__"))
      return <strong key={id}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~"))
      return <s key={id}>{part.slice(2, -2)}</s>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={id} className="rounded bg-surface0/70 px-1 py-0.5 text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={id}>{part.slice(1, -1)}</em>;
    if (part.startsWith("_") && part.endsWith("_"))
      return <em key={id}>{part.slice(1, -1)}</em>;
    if (part.startsWith("![") && part.includes("](")) {
      const alt = part.slice(2, part.indexOf("]("));
      const url = part.slice(part.indexOf("](") + 2, -1);
      return (
        <img
          key={id}
          src={url}
          alt={alt}
          loading="lazy"
          className="my-1 max-h-64 rounded-md border border-surface1/60 object-contain"
        />
      );
    }
    if (part.startsWith("[") && part.includes("](")) {
      const label = part.slice(1, part.indexOf("]("));
      const url = part.slice(part.indexOf("](") + 2, -1);
      return link(url, label, id);
    }
    if (/^https?:\/\//.test(part)) return link(part, part, id);
    return <span key={id}>{part}</span>;
  });
}

export function Md({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  let fence: string[] | null = null;
  let quote: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    const items = list.map((item, index) => (
      <li key={`li-${out.length}-${index}`} className="ml-4 list-outside">
        {inline(item, `li-${out.length}-${index}`)}
      </li>
    ));
    out.push(
      ordered ? (
        <ol key={`ol-${out.length}`} className="my-1 list-decimal space-y-0.5">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${out.length}`} className="my-1 list-disc space-y-0.5">
          {items}
        </ul>
      ),
    );
    list = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    out.push(
      <blockquote
        key={`q-${out.length}`}
        className="my-1 border-l-2 border-surface1 pl-2 text-subtext0 italic"
      >
        {inline(quote.join(" "), `q-${out.length}`)}
      </blockquote>,
    );
    quote = [];
  };

  for (const line of lines) {
    if (fence) {
      if (line.trimStart().startsWith("```")) {
        out.push(
          <pre
            key={`pre-${out.length}`}
            className="my-1 overflow-x-auto rounded-md bg-crust/80 p-2 text-[0.8em] leading-relaxed"
          >
            <code>{fence.join("\n")}</code>
          </pre>,
        );
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flushList();
      flushQuote();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      flushList();
      flushQuote();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushQuote();
      const size =
        heading[1].length === 1
          ? "text-base font-semibold"
          : heading[1].length === 2
            ? "text-sm font-semibold"
            : "text-xs font-semibold uppercase tracking-wide";
      out.push(
        <p key={`h-${out.length}`} className={`mt-2 mb-1 ${size}`}>
          {inline(heading[2], `h-${out.length}`)}
        </p>,
      );
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      flushList();
      flushQuote();
      out.push(<hr key={`hr-${out.length}`} className="my-2 border-surface1/60" />);
      continue;
    }
    if (line.trimStart().startsWith("> ")) {
      flushList();
      quote.push(line.trimStart().slice(2));
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flushQuote();
      if (ordered) flushList();
      ordered = false;
      list.push(bullet[1]);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushQuote();
      if (!ordered) flushList();
      ordered = true;
      list.push(numbered[1]);
      continue;
    }
    flushList();
    flushQuote();
    out.push(
      <p key={`p-${out.length}`} className="my-0.5">
        {inline(line, `p-${out.length}`)}
      </p>,
    );
  }

  if (fence) {
    out.push(
      <pre
        key={`pre-${out.length}`}
        className="my-1 overflow-x-auto rounded-md bg-crust/80 p-2 text-[0.8em] leading-relaxed"
      >
        <code>{fence.join("\n")}</code>
      </pre>,
    );
  }
  flushList();
  flushQuote();

  return <div className={`whitespace-pre-line break-words ${className}`}>{out}</div>;
}
