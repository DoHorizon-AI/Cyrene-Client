import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ResizeHandle } from "./Chrome";
import { useI18n } from "../i18n";

export type EditorId = "graph" | "source" | "file" | "monitor" | "product" | "assistant";
export interface EditorWorkspaceHandle { split(id: EditorId, side?: "left" | "right"): void; merge(id: EditorId): void }
interface Tab { id: EditorId; label: ReactNode; content(visible: boolean): ReactNode }
interface Props {
  tabs: Tab[]; active: EditorId; ratio: number;
  onSelect(id: EditorId): void; onRatio(value: number): void;
  onLayout(value: { split: boolean; visible: EditorId[] }): void;
}
type DropTarget = "left" | "right" | "join-left" | "join-right";

// Each document owns one portal container. Moving tabs moves that container,
// preserving the canvas instance, unfinished forms and the monitor subscription.
function EditorPanel({ target, visible, children, onFocus }: { target: RefObject<HTMLDivElement | null>; visible: boolean; children: ReactNode; onFocus(): void }) {
  const [host] = useState(() => { const node = document.createElement("div"); node.className = "ide-editor-panel"; return node; });
  useLayoutEffect(() => { target.current?.appendChild(host); return () => host.remove(); }, [host, target]);
  useLayoutEffect(() => { host.hidden = !visible; }, [host, visible]);
  return createPortal(<div className="ide-editor-panel-content" onFocusCapture={onFocus} onPointerDownCapture={onFocus}>{children}</div>, host);
}

export const EditorWorkspace = forwardRef<EditorWorkspaceHandle, Props>(function EditorWorkspace({ tabs, active, ratio, onSelect, onRatio, onLayout }, ref) {
  const { locale } = useI18n(), tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const area = useRef<HTMLDivElement>(null), left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [groups, setGroups] = useState<{ right: EditorId[]; active: [EditorId, EditorId] }>({ right: [], active: [active, "monitor"] });
  const drag = useRef<EditorId | null>(null), [drop, setDrop] = useState<DropTarget | null>(null);
  const ids = tabs.map(tab => tab.id), rightIds = ids.filter(id => groups.right.includes(id));
  const leftIds = ids.filter(id => !rightIds.includes(id));
  const split = rightIds.length > 0 && leftIds.length > 0, splitVisible = split && width >= 645;
  const selected = (group: number) => {
    const members = group ? rightIds : leftIds;
    return members.includes(active) ? active : members.includes(groups.active[group]) ? groups.active[group] : members[0];
  };
  const visible: EditorId[] = splitVisible ? [selected(0), selected(1)] : [ids.includes(active) ? active : ids[0]];
  const visibleKey = visible.join(",");
  useEffect(() => { onLayout({ split, visible }); }, [split, visibleKey, onLayout]);
  // Menu actions can activate a document without going through its tab button.
  useEffect(() => {
    const index = rightIds.includes(active) ? 1 : 0;
    setGroups(value => {
      if (value.active[index] === active) return value;
      const next: [EditorId, EditorId] = [...value.active]; next[index] = active;
      return { ...value, active: next };
    });
  }, [active, rightIds.join(",")]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (area.current) observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const cancelDrag = () => { drag.current = null; setDrop(null); };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") cancelDrag(); };
    window.addEventListener("keydown", cancel, true); window.addEventListener("blur", cancelDrag);
    return () => { window.removeEventListener("keydown", cancel, true); window.removeEventListener("blur", cancelDrag); };
  }, []);
  const select = (id: EditorId) => {
    const index = rightIds.includes(id) ? 1 : 0;
    setGroups(value => { const next: [EditorId, EditorId] = [...value.active]; next[index] = id; return { ...value, active: next }; });
    onSelect(id);
  };
  const merge = (id: EditorId) => { setGroups({ right: [], active: [id, "monitor"] }); onSelect(id); };
  const place = (id: EditorId, target: DropTarget) => {
    if (!ids.includes(id)) return;
    if (!split && target.startsWith("join")) { select(id); return; }
    const toRight = target.endsWith("right");
    const nextRight = split ? ids.filter(candidate => candidate === id ? toRight : rightIds.includes(candidate)) : toRight ? [id] : ids.filter(candidate => candidate !== id);
    if (!nextRight.length || nextRight.length === ids.length) { merge(id); return; }
    const nextActive = [0, 1].map(index => {
      const members = ids.filter(candidate => nextRight.includes(candidate) === !!index);
      return members.includes(id) ? id : members.includes(visible[index]) ? visible[index] : members[0];
    }) as [EditorId, EditorId];
    setGroups({ right: nextRight, active: nextActive }); onSelect(id);
  };
  useImperativeHandle(ref, () => ({ split: (id, side = "right") => place(id, side), merge }));
  const firstWidth = Math.max(280, Math.min(width - 285, (width - 5) * ratio));
  return <div ref={area} className={`ide-editor-area ${splitVisible ? "is-split" : ""}`} style={splitVisible ? { gridTemplateColumns: `${firstWidth}px 5px minmax(0, 1fr)` } : undefined}
    onDragOver={event => {
      if (!drag.current) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      const strip = (event.target as HTMLElement).closest<HTMLElement>("[data-editor-tabs]");
      const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width;
      setDrop(strip ? strip.dataset.editorTabs === "1" ? "join-right" : "join-left" : x < 0.25 ? "left" : x > 0.75 ? "right" : splitVisible ? event.clientX - box.left < firstWidth ? "join-left" : "join-right" : "join-left");
    }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
    onDropCapture={event => { if (!drag.current) return; event.preventDefault(); event.stopPropagation(); if (drop) place(drag.current, drop); cancelDrag(); }}>
    {[0, 1].map(index => <div key={index} className="ide-editor-group" data-editor-group={index} hidden={index === 1 && !splitVisible}>
      <div className="ide-editor-tabs" data-editor-tabs={index} role="tablist" aria-label={splitVisible ? index ? tx("右侧编辑器页面", "Right editor tabs") : tx("左侧编辑器页面", "Left editor tabs") : tx("编辑器页面", "Editor tabs")}>
        {tabs.filter(tab => splitVisible ? rightIds.includes(tab.id) === !!index : index === 0).map(tab => <button key={tab.id} role="tab" draggable aria-selected={visible.includes(tab.id)} className={visible.includes(tab.id) ? "active" : ""}
          title={tx("拖至主区域左/右边缘分栏，拖至另一标签栏合并", "Drag to an editor edge to split; drag to another tab bar to merge")}
          onClick={() => select(tab.id)} onDragStart={event => { drag.current = tab.id; event.dataTransfer.setData("application/x-cyrene-editor-tab", tab.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={cancelDrag}>{tab.label}</button>)}
      </div>
      <div className="ide-editor-group-body" ref={index ? right : left} />
    </div>)}
    {splitVisible && <ResizeHandle orientation="vertical" value={Math.round(firstWidth)} min={Math.max(280, (width - 5) * 0.25)} max={Math.min(width - 285, (width - 5) * 0.75)} label={tx("调整编辑区分栏宽度", "Resize editor split")} onChange={value => onRatio(value / (width - 5))} />}
    {drop && <div className={`ide-editor-drop ${drop}`} style={splitVisible ? { width: drop.endsWith("right") ? width - firstWidth - 5 : firstWidth } : undefined} aria-hidden="true"><span>{drop === "left" ? tx("移至左侧分栏", "Move to left split") : drop === "right" ? tx("移至右侧分栏", "Move to right split") : tx("移入标签组", "Move into tab group")}</span></div>}
    {tabs.map(tab => <EditorPanel key={tab.id} target={splitVisible && rightIds.includes(tab.id) ? right : left} visible={visible.includes(tab.id)} onFocus={() => { if (active !== tab.id) select(tab.id); }}>{tab.content(visible.includes(tab.id))}</EditorPanel>)}
  </div>;
});
