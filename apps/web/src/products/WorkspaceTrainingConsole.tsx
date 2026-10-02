// Role: Select an authorized Workspace and start or observe its prepared Yield runs.
// 中文：选择已授权 Workspace，并启动或观察其中已准备的 Yield 任务。

import { useEffect, useMemo, useRef, useState } from "react";
import { makeIdempotencyKey, type JsonRecord } from "../../services/navigator/src/api";
import { RunsPage } from "../../services/navigator/src/pages";
import { pushRunRoute, type RouteId } from "../../services/navigator/src/router";
import { useI18n } from "../i18n";
import { WorkspaceBffClient, type WorkspaceSummary } from "../services/workspace-bff-client";
import { WorkspaceTrainingClient } from "./workspace-training-api";

/** Discovery never treats a local server registration as a trusted execution target.
 * 中文：发现过程不会把本地服务器登记当作受信执行目标。
 */
export function WorkspaceTrainingConsole({ route }: { route: RouteId }) {
  const { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const bff = useMemo(() => new WorkspaceBffClient(), []);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => new URLSearchParams(window.location.search).get("workspaceId") ?? "");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setWorkspaces([]);
    void bff.discoverWorkspaces(controller.signal).then((values) => {
      if (!controller.signal.aborted) { setWorkspaces(values); setLoading(false); }
    }, (reason: unknown) => {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { controller.abort(); bff.reset(); };
  }, [bff, revision]);
  useEffect(() => {
    const navigate = () => {
      const workspace = new URLSearchParams(window.location.search).get("workspaceId");
      if (workspace !== null) setWorkspaceId(workspace);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  const selected = workspaces.find((workspace) => workspace.workspaceId === workspaceId);
  const api = useMemo(() => selected ? new WorkspaceTrainingClient(bff, selected.workspaceId, selected.organizationId) : null, [bff, selected]);
  const choose = (value: string) => {
    setWorkspaceId(value);
    const url = new URL(window.location.href);
    url.searchParams.delete("runId");
    url.pathname = route === "runs" ? "/runs" : "/training";
    if (value) url.searchParams.set("workspaceId", value);
    else url.searchParams.delete("workspaceId");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return <div className="product-workspace page-stack">
    <section className="product-connection">
      <h2>{tx("Workspace 训练", "Workspace training")}</h2>
      <p>{tx("选择有权限的工作空间。任务在该工作空间配置的执行设备运行，实际资源由执行端分配。", "Select an authorized workspace. Runs use its configured execution device; the execution host allocates resources.")}</p>
      <label>{tx("工作空间", "Workspace")} <select value={selected?.workspaceId ?? ""} disabled={loading} onChange={(event) => choose(event.target.value)}>
        <option value="">{tx("请选择工作空间", "Select a workspace")}</option>
        {workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.displayName}</option>)}
      </select></label>
      <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>{tx("刷新连接", "Refresh connection")}</button>
      {loading && <p role="status">{tx("正在读取已授权工作空间…", "Reading authorized workspaces…")}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && workspaces.length === 0 && <p>{tx("当前账号没有可访问的工作空间。", "This account has no accessible workspaces.")}</p>}
      {!loading && workspaceId && !selected && <p role="alert">{tx("链接中的工作空间不在当前账号的授权列表中。请重新选择。", "The linked workspace is not authorized for this account. Select a workspace again.")}</p>}
    </section>
    {api && !loading && (route === "runs"
      ? <RunsPage key={`${revision}:${workspaceId}`} api={api} />
      : <WorkspacePreparedDraft key={`${revision}:${workspaceId}`} api={api} />)}
  </div>;
}

function WorkspacePreparedDraft({ api }: { api: WorkspaceTrainingClient }) {
  const { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [draftId, setDraftId] = useState("");
  const [draft, setDraft] = useState<JsonRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  useEffect(() => () => command.current?.abort(), [api]);
  const read = async () => {
    if (command.current) return;
    const controller = new AbortController();
    command.current = controller;
    setBusy(true); setError(""); setDraft(null);
    try {
      const result = await api.getDraft(draftId.trim(), controller.signal);
      if (!controller.signal.aborted) setDraft(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) { command.current = null; setBusy(false); }
    }
  };
  const start = async () => {
    if (!draft || command.current) return;
    const id = String(draft.id);
    const controller = new AbortController();
    command.current = controller;
    let key = keys.current.get(id);
    if (!key) { key = makeIdempotencyKey(); keys.current.set(id, key); }
    setBusy(true); setError("");
    try {
      const runId = await api.startDraft(id, key, controller.signal);
      if (!controller.signal.aborted) pushRunRoute(runId, api.workspaceId);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) { command.current = null; setBusy(false); }
    }
  };
  return <section className="product-connection">
    <h2>{tx("启动已准备的训练草稿", "Start a prepared training draft")}</h2>
    <p>{tx("填写该工作空间中的 Yield 草稿 ID。读取草稿不会启动任务；确认启动后进入任务页面。", "Enter a Yield draft ID from this workspace. Reading does not start training; starting opens the accepted run.")}</p>
    <form onSubmit={(event) => { event.preventDefault(); void read(); }}>
      <label>{tx("训练草稿 ID", "Training draft ID")} <input value={draftId} disabled={busy} onChange={(event) => { setDraftId(event.target.value); setDraft(null); }} /></label>
      <button disabled={busy || !draftId.trim()}>{tx("读取草稿", "Read draft")}</button>
    </form>
    {draft && <div>
      <p>{String(draft.name ?? draft.id)} · {String(draft.state)}</p>
      <button disabled={busy || !["PREPARED", "STARTED"].includes(String(draft.state))} onClick={() => void start()}>
        {draft.trainingRunId ? tx("打开已有任务", "Open existing run") : tx("确认启动训练", "Confirm training start")}
      </button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
