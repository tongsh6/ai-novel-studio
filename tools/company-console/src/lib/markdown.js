import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true
});

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source || ""));
}

