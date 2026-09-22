import { useEffect, useRef, useState } from "react";
import { examplePipeline, parsePipeline, type Pipeline } from "../../../../packages/pipeline-model";
import type { GraphHandle } from "../graph/GraphCanvas";

const STORAGE_KEY = "cyrene.studio.prototype.v1.draft";
interface Options {
  selectedId: string | null;
  onSelect(id: string | null): void;
  onNotice(message: string): void;
  onResetPreview(): void;
  onShowGraph(): void;
}

// Own document history and persistence here; App composes the workbench UI.
export function usePipelineDocument(options: Options) {
  const [initial] = useState(examplePipeline);
  const [pipeline, setPipeline] = useState(initial);
  const [dirty, setDirty] = useState(false), dirtyRef = useRef(false);
  const [savedDraft, setSavedDraft] = useState(false), [undoCount, setUndoCount] = useState(0);
  const current = useRef(initial), history = useRef<Pipeline[]>([]);
  const editor = useRef<GraphHandle>(null), fileInput = useRef<HTMLInputElement>(null);
  const live = useRef(options); live.current = options;
  const mounted = useRef(false), imports = useRef(0);

  useEffect(() => {
    mounted.current = true;
    try { setSavedDraft(localStorage.getItem(STORAGE_KEY) !== null); }
    catch { live.current.onNotice("浏览器存储不可用；仍可使用 JSON 导出保存。"); }
    return () => { mounted.current = false; imports.current++; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function error(e: unknown) {
    if (mounted.current) live.current.onNotice(`操作未完成：${e instanceof Error ? e.message : String(e)}`);
  }
  function requireEditor() {
    const handle = editor.current;
    if (!handle) throw new Error("画布尚未就绪，请稍后重试。");
    return handle;
  }
  function withEditor(action: (handle: GraphHandle) => void) {
    try { action(requireEditor()); } catch (e) { error(e); }
  }
  function publish(p: Pipeline, unsaved: boolean) {
    current.current = p; setPipeline(p);
    dirtyRef.current = unsaved; setDirty(unsaved);
    live.current.onResetPreview();
  }
  function recordChange(p: Pipeline) {
    if (JSON.stringify(current.current) === JSON.stringify(p)) return;
    history.current = [...history.current.slice(-49), structuredClone(current.current)];
    setUndoCount(history.current.length); publish(p, true);
  }
  function changed(p: Pipeline) { recordChange({ ...p, name: current.current.name }); }
  function loadCanvas(p: Pipeline, fit = true) {
    const handle = requireEditor(), selected = live.current.selectedId;
    handle.load(p, { silent: true, fit });
    if (selected && p.nodes.some(n => n.id === selected)) handle.select(selected);
  }
  function applyDocument(p: Pipeline) { loadCanvas(p); recordChange(p); }
  function loadServerDocument(p: Pipeline) {
    loadCanvas(p, false); publish(p, false);
    history.current = []; setUndoCount(0);
  }
  function undoLocal() {
    try {
      const p = history.current.at(-1); if (!p) return;
      loadCanvas(p); history.current.pop(); publish(p, true); setUndoCount(history.current.length);
      live.current.onNotice("已撤销本地修改；服务端版本尚未改变。");
    } catch (e) { error(e); }
  }
  function snapshot() { return { ...requireEditor().snapshot(), name: current.current.name }; }
  function replace(p: Pipeline, message: string) {
    if (dirtyRef.current && !window.confirm("当前流程有未保存修改，是否替换？")) return;
    applyDocument(p); live.current.onSelect(null); live.current.onResetPreview(); live.current.onShowGraph();
    live.current.onNotice(message);
  }
  function save() {
    try {
      const p = parsePipeline(snapshot()); localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      setSavedDraft(true); dirtyRef.current = false; setDirty(false);
      live.current.onNotice("草稿已保存到此浏览器。可导出 JSON 另存备份。");
    } catch (e) { error(e); }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("没有本地草稿。");
      replace(parsePipeline(JSON.parse(raw)), "已载入本地草稿。");
    } catch (e) { error(e); }
  }
  function exportJson() {
    try {
      const p = parsePipeline(snapshot());
      const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `${p.id}.json`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      live.current.onNotice("已导出流程定义与布局。运行预演记录不会写入文件。");
    } catch (e) { error(e); }
  }
  async function importJson(file?: File) {
    if (!file) return;
    const version = ++imports.current, sent = current.current;
    try {
      if (file.size > 1024 * 1024) throw new Error("文件不能超过 1 MB。");
      const text = await file.text();
      if (!mounted.current || version !== imports.current) return;
      if (current.current !== sent) throw new Error("导入期间画布已修改，旧结果未应用，请重试。");
      replace(parsePipeline(JSON.parse(text)), "已导入流程。请校验连接与参数后预演。");
    } catch (e) { if (version === imports.current) error(e); }
    finally { if (version === imports.current && fileInput.current) fileInput.current.value = ""; }
  }

  return { initial, pipeline, editor, fileInput, dirty, savedDraft, undoCount, changed, recordChange,
    applyDocument, loadServerDocument, undoLocal, snapshot, replace, save, restore, exportJson, importJson, withEditor };
}
