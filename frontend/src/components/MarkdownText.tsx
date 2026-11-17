// Design: docs/design/ui/46-state-and-feedback.md §9.5 / ADR-0036
// Prototype: novel-studio.pen → 46§9-agentic-loop-reasoning-flow (DM8gx)
import { cjk } from "@streamdown/cjk";
import { Streamdown, defaultRehypePlugins, type Components, type UrlTransform } from "streamdown";

import styles from "./MarkdownText.module.css";

const plugins = { cjk };
// Raw HTML stays escaped text. Sanitization remains; URL/image policy is owned below,
// rather than the library's navigable-link/image hardening and English fallback UI.
const rehypePlugins = [defaultRehypePlugins.sanitize];
const linkSafety = { enabled: false };
const safeUrl: UrlTransform = (url, key) => {
  if (key !== "href") return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
};

// Read-only presentation: no WebView navigation, external image requests or browser IO.
const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  a: ({ children, href }) => (
    <span className={styles.link}>
      {children}
      {href ? ` (${href})` : ""}
    </span>
  ),
  img: ({ alt }) => <span>{alt ?? ""}</span>,
  table: ({ children }) => (
    <div className={styles.table}>
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
};

/** Rendering only; the caller owns the unchanged source and actual streaming state. */
export function MarkdownText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className={styles.root}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      normalizeHtmlIndentation={false}
      plugins={plugins}
      rehypePlugins={rehypePlugins}
      components={components}
      urlTransform={safeUrl}
      skipHtml
      controls={false}
      linkSafety={linkSafety}
    >
      {text}
    </Streamdown>
  );
}
