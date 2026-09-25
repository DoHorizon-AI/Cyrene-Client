import { useEffect, useRef, useState, type ReactNode } from "react";

export type IconName = "files" | "nodes" | "servers" | "info" | "plugins" | "assistant" | "check" | "play" | "log" | "close" | "chevron" | "folder";
const paths: Record<IconName, ReactNode> = {
  files: <><path d="M5 3h8l4 4v14H5z" /><path d="M13 3v5h4M8 12h6M8 16h6" /></>,
  nodes: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h9v9M6 9v9h9" /></>,
  servers: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  plugins: <><path d="M4 8h5V5a3 3 0 0 1 6 0v3h5v5h-3a3 3 0 0 0 0 6h3v2H4z" /></>,
  assistant: <><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
  play: <path d="m7 4 13 8-13 8z" />,
  log: <><path d="m4 7 4 4-4 4M12 17h8" /><rect x="1" y="2" width="22" height="20" rx="2" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  folder: <path d="M2 6h8l2 3h10v11H2zM2 6V4h8l2 2h8v3" />,
};
export function Icon({ name }: { name: IconName }) { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>; }

export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", dismiss); return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div className="ide-menu" ref={root} onKeyDown={e => {
    if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); e.stopPropagation(); }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault(); setOpen(true);
      requestAnimationFrame(() => {
        const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".ide-menu-popup button:not(:disabled), .ide-menu-popup select") ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[index < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      });
    }
  }}><button ref={trigger} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>{label}</button>
    <div className="ide-menu-popup" hidden={!open} aria-label={`${label}菜单`} onClick={e => {
      const target = (e.target as HTMLElement).closest("button");
      if (target && !target.disabled && !target.closest(".keep-menu-open")) setOpen(false);
    }}>{children}</div>
  </div>;
}

export function ResizeHandle({ orientation, value, min, max, sign = 1, label, onChange }: { orientation: "vertical" | "horizontal"; value: number; min: number; max: number; sign?: number; label: string; onChange(v: number): void }) {
  const drag = useRef<{ pointer: number; start: number; value: number } | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return <div className={`ide-resize ide-resize-${orientation}`} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { pointer: e.pointerId, start: orientation === "vertical" ? e.clientX : e.clientY, value }; }}
    onPointerMove={e => { if (drag.current) onChange(clamp(drag.current.value + sign * ((orientation === "vertical" ? e.clientX : e.clientY) - drag.current.start))); }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => { const direction = ["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 0; if (direction) { e.preventDefault(); onChange(clamp(value + direction * sign * (e.shiftKey ? 40 : 16))); } }} />;
}

export type LeftTool = "files" | "nodes" | "servers";
export type RightTool = "info" | "plugins" | "assistant";
interface Layout { left: LeftTool | null; right: RightTool | null; bottom: boolean; leftWidth: number; rightWidth: number; bottomHeight: number }
export function useIdeLayout() {
  const defaults: Layout = { left: innerWidth < 1000 ? null : "nodes", right: innerWidth < 1000 ? null : "info", bottom: true, leftWidth: 240, rightWidth: 310, bottomHeight: 175 };
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const s = JSON.parse(localStorage.getItem("cyrene.studio.layout.v1") ?? "null");
      if (!s) return defaults;
      return { left: innerWidth < 1000 ? null : ["files", "nodes", "servers", null].includes(s.left) ? s.left : defaults.left, right: innerWidth < 1000 ? null : ["info", "plugins", "assistant", null].includes(s.right) ? s.right : defaults.right, bottom: typeof s.bottom === "boolean" ? s.bottom : true,
        leftWidth: bounded(s.leftWidth, 210, 480, 240), rightWidth: bounded(s.rightWidth, 260, 520, 310), bottomHeight: bounded(s.bottomHeight, 100, 400, 175) };
    } catch { return defaults; }
  });
  useEffect(() => { try { localStorage.setItem("cyrene.studio.layout.v1", JSON.stringify(layout)); } catch { /* Layout preferences are optional. 布局偏好设置为可选项。 */ } }, [layout]);
  useEffect(() => {
    const resize = () => { if (innerWidth < 1000) setLayout(s => s.left && s.right ? { ...s, left: null } : s); };
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  const left = (tool: LeftTool) => setLayout(s => ({ ...s, left: s.left === tool ? null : tool, ...(innerWidth < 1000 ? { right: null } : {}) }));
  const right = (tool: RightTool) => setLayout(s => ({ ...s, right: s.right === tool ? null : tool, ...(innerWidth < 1000 ? { left: null } : {}) }));
  return { layout, setLayout, left, right, reset: () => setLayout(defaults) };
}
function bounded(v: unknown, min: number, max: number, fallback: number) { return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; }
