import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ text, tx }: { text: string; tx(zh: string, en: string): string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    pre: ({ children }) => <div className="assistant-code">
      <button title={tx('复制代码', 'Copy code')} onClick={e => void navigator.clipboard.writeText(e.currentTarget.parentElement?.querySelector('pre')?.textContent ?? '')}>{tx('复制', 'Copy')}</button>
      <pre>{children}</pre>
    </div>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    // Model output is untrusted. An image URL may encode private context;
    // rendering the transcript must never send that URL to another host.
    img: ({ alt }) => <span className="assistant-muted">[{tx('图片未自动加载', 'Image not loaded')}{alt ? `: ${alt}` : ''}]</span>,
  }}>{text}</ReactMarkdown>;
}
