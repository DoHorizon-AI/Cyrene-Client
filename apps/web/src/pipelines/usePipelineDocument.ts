import { useEffect, useRef, useState } from "react";
import { examplePipeline, parsePipeline, type Pipeline } from "../../../../packages/pipeline-model";
import type { GraphHandle } from "../graph/GraphCanvas";
import { listRecoveries, saveRecovery, recoveryDocumentSchema, type Recovery } from "./recovery";
import { useTeamIdentity } from "../team/TeamGate";
import type { PipelineRecord } from "../../../../packages/pipeline-control/contracts";

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
  const identity = useTeamIdentity();
  const storageKey = identity.actorId === "local-user" && identity.workspaceId === "local" ? STORAGE_KEY : `${STORAGE_KEY}:${identity.actorId}:${identity.workspaceId}`;
  const [tabId] = useState(() => crypto.randomUUID());
  const [recoveries, setRecoveries] = useState<Recovery[]>([]), [recoveryStatus, setRecoveryStatus] = useState("");
  const recoverySequence = useRef(0), recoveryQueue = useRef(Promise.resolve());
  const [initial] = useState(examplePipeline);
  const [pipeline, setPipeline] = useState(initial);
  const [dirty, setDirty] = useState(false), dirtyRef = useRef(false);
  const [savedDraft, setSavedDraft] = useState(false), [undoCount, setUndoCount] = useState(0);
  const current = useRef(initial), history = useRef<Pipeline[]>([]);
  const [serverBase, setServerBase] = useState<PipelineRecord | null>(null);
  const baseRef = useRef<PipelineRecord | null>(null);
  const editor = useRef<GraphHandle>(null), fileInput = useRef<HTMLInputElement>(null);
  const live = useRef(options); live.current = options;
  const mounted = useRef(false), imports = useRef(0);

  useEffect(() => {
    mounted.current = true;
    try { setSavedDraft(localStorage.getItem(storageKey) !== null); }
    catch { live.current.onNotice("浏览器存储不可用；仍可使用 JSON 导出保存。"); }
    return () => { mounted.current = false; imports.current++; };
  }, []);
  useEffect(() => { let active = true; void listRecoveries(identity.actorId, identity.workspaceId).then(rows => { if (active) setRecoveries(rows); }).catch(() => { if (active) setRecoveryStatus("恢复存储不可用，请导出备份"); }); return () => { active = false; }; }, [identity.actorId, identity.workspaceId]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => persistRecovery(), 1500);
    return () => window.clearInterval(timer);
  }, [dirty]);
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
    if (baseRef.current?.document.id !== p.id) { baseRef.current = null; setServerBase(null); }
    current.current = p; setPipeline(p);
    dirtyRef.current = unsaved; setDirty(unsaved);
    live.current.onResetPreview();
    if (unsaved) persistRecovery();
  }
  function persistRecovery() {
    const sequence = ++recoverySequence.current;
    const record: Recovery = { id: `${identity.actorId}:${identity.workspaceId}:${tabId}:${current.current.id}`, ...identity, tabId, sequence, savedAt: new Date().toISOString(), document: structuredClone(current.current), history: structuredClone(history.current), selectedId: live.current.selectedId, view: editor.current?.getView?.(), ...(baseRef.current ? { serverBase: structuredClone(baseRef.current) } : {}) };
    setRecoveryStatus("正在保存恢复记录");
    recoveryQueue.current = recoveryQueue.current.catch(() => {}).then(() => saveRecovery(record)).then(() => {
      if (mounted.current && sequence === recoverySequence.current) setRecoveryStatus("编辑可恢复");
    }).catch(() => { if (mounted.current) setRecoveryStatus("恢复保存失败，请导出备份"); });
  }
  function updateServerBase(record: PipelineRecord | null) {
    if (record && (record.workspaceId !== identity.workspaceId || record.document.id !== current.current.id)) return;
    baseRef.current = record; setServerBase(record);
    if (dirtyRef.current) persistRecovery();
  }
  function recover(id: string) {
    try {
      const record = recoveries.find(row => row.id === id); if (!record) throw new Error("恢复记录不存在。");
      if (dirtyRef.current && !window.confirm("当前有新编辑，是否载入恢复记录？")) return;
      const p = recoveryDocumentSchema.parse(record.document);
      if (record.serverBase && (record.serverBase.workspaceId !== identity.workspaceId || record.serverBase.document.id !== p.id)) throw new Error("恢复记录的服务端基线与流程身份不匹配。");
      loadCanvas(p, false); history.current = record.history.map(row => recoveryDocumentSchema.parse(row)); setUndoCount(history.current.length);
      baseRef.current = record.serverBase ?? null; setServerBase(baseRef.current);
      if (record.selectedId && p.nodes.some(node => node.id === record.selectedId)) requireEditor().select(record.selectedId);
      if (record.view) requireEditor().setView?.(record.view);
      publish(p, true); live.current.onNotice(record.serverBase ? "已恢复编辑、撤销历史及服务端版本基线；保存时将检查并发修改。" : "已恢复编辑和撤销历史；此记录没有服务端基线，尚未覆盖服务端版本。");
    } catch (e) { error(e); }
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
    baseRef.current = null; setServerBase(null);
    applyDocument(p); live.current.onSelect(null); live.current.onResetPreview(); live.current.onShowGraph();
    live.current.onNotice(message);
  }
  function save() {
    try {
      const p = parsePipeline(snapshot()); localStorage.setItem(storageKey, JSON.stringify(p));
      setSavedDraft(true); dirtyRef.current = false; setDirty(false);
      live.current.onNotice("草稿已保存到此浏览器。可导出 JSON 另存备份。");
    } catch (e) { error(e); }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(storageKey);
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
    applyDocument, loadServerDocument, undoLocal, snapshot, replace, save, restore, exportJson, importJson, withEditor, recoveries, recoveryStatus, recover, serverBase, updateServerBase };
}
