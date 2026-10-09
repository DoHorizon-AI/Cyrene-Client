import { Fragment, type ReactNode } from "react";

// Render a deliberately small Markdown subset. React escapes raw HTML and
// images stay text: an untrusted transcript must not make network requests.
function inline(text: string): ReactNode[] {
  const pieces: ReactNode[] = [];
  const pattern = /(!?\[[^\]]*\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    pieces.push(text.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("![")) pieces.push(<span key={index} className="assistant-muted">[{token.slice(2, token.indexOf("]")) || "Image"}]</span>);
    else if (token.startsWith("[")) {
      const split = token.indexOf("]("), href = token.slice(split + 2, -1), label = token.slice(1, split);
      pieces.push(/^(https?:|mailto:)/i.test(href)
        ? <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        : <Fragment key={index}>{label}</Fragment>);
    } else if (token.startsWith("`")) pieces.push(<code key={index}>{token.slice(1, -1)}</code>);
    else pieces.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    cursor = index + token.length;
  }
  pieces.push(text.slice(cursor));
  return pieces;
}

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    if (lines[i].startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push(<pre key={start}><code>{code.join("\n")}</code></pre>);
    } else if (/^#{1,6}\s/.test(lines[i])) {
      blocks.push(<p key={start}><strong>{inline(lines[i].replace(/^#{1,6}\s/, ""))}</strong></p>);
    } else if (/^[-*]\s/.test(lines[i])) {
      const items: ReactNode[] = [];
      do { items.push(<li key={i}>{inline(lines[i].slice(2))}</li>); i++; } while (i < lines.length && /^[-*]\s/.test(lines[i]));
      i--; blocks.push(<ul key={start}>{items}</ul>);
    } else if (lines[i].trim()) {
      const paragraph = [lines[i]];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(```|#{1,6}\s|[-*]\s)/.test(lines[i + 1])) paragraph.push(lines[++i]);
      blocks.push(<p key={start} style={{ whiteSpace: "pre-wrap" }}>{inline(paragraph.join("\n"))}</p>);
    }
  }
  return <>{blocks}</>;
}
