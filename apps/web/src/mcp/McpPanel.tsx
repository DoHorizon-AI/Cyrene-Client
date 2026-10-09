import { useEffect, useRef, useState } from "react";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Pipeline } from "../../../../packages/pipeline-model";
import { useTeamIdentity } from "../team/TeamGate";
import { useI18n } from "../i18n";
import { connectMcp } from "./client";
import "./mcp.css";

type Entry = { id: number; name: string; input: unknown; result: unknown };
export default function McpPanel({ document, selectedId, onNotice, onMonitor }: { document: Pipeline; selectedId: string | null; onNotice(message: string): void; onMonitor(): void }) {
  const { workspaceId, actorId, scopes } = useTeamIdentity(), { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const client = useRef<Client | null>(null), mounted = useRef(true), sequence = useRef(0), working = useRef(false);
  const [tools, setTools] = useState<Tool[]>([]), [info, setInfo] = useState<{ diagnostics: boolean; readOnly: boolean; protocolVersion: string } | null>(null);
  const [tab, setTab] = useState("tools"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState("monitoring_snapshot"), [args, setArgs] = useState("{}"), [entries, setEntries] = useState<Entry[]>([]), [query, setQuery] = useState("");
  const [testRun, setTestRun] = useState(""), testContext = useRef<{ id: string; document?: unknown; input?: Record<string, unknown>; fingerprint?: string; runKey: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void client.current?.close(); }; }, []);
  const tool = tools.find(t => t.name === name);
  function seed(tool: Tool) {
    const fields = tool.inputSchema.properties ?? {};
    const value: Record<string, unknown> = {};
    if ("workspaceId" in fields) value.workspaceId = workspaceId;
    if ("pipelineId" in fields) value.pipelineId = document.id;
    if ("nodeId" in fields && selectedId) value.nodeId = selectedId;
    if ("idempotencyKey" in fields) value.idempotencyKey = crypto.randomUUID();
    setName(tool.name); setArgs(JSON.stringify(value, null, 2));
  }
  async function perform(action: () => Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  async function connect() {
    await client.current?.close(); client.current = null; setInfo(null); setTools([]);
    const response = await fetch("/studio-mcp/v1/info", { signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error(tx("请启动统一控制服务：npm run dev", "Start the unified control service: npm run dev"));
    const data = await response.json(), next = await connectMcp();
    const listed = (await next.listTools()).tools;
    if (!mounted.current) { await next.close(); return; }
    client.current = next; setInfo(data); setTools(listed);
    const initial = listed.find(t => t.name === "monitoring_snapshot") ?? listed[0]; if (initial) seed(initial);
  }
  async function invoke(name: string, input: Record<string, unknown>) {
    if (!client.current) throw new Error(tx("请先连接 MCP", "Connect MCP first"));
    const result = await client.current.callTool({ name, arguments: input });
    if (mounted.current) setEntries(old => [{ id: ++sequence.current, name, input, result }, ...old].slice(0, 30));
    return result;
  }
  async function checked(name: string, input: Record<string, unknown>) {
    if (!mounted.current) throw new Error("Context changed; remaining operations cancelled");
    const result = await invoke(name, input);
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return result.structuredContent as Record<string, any>;
  }
  async function diagnostic() {
    if (!client.current) return;
    const context = testContext.current ??= { id: `diagnostic-${crypto.randomUUID()}`, runKey: crypto.randomUUID() };
    if (!context.document) {
      const resource = await client.current.readResource({ uri: "cyrene://templates/local-diagnostic" });
      const content = resource.contents[0]; if (!("text" in content)) throw new Error("Invalid diagnostic template");
      context.document = { ...JSON.parse(content.text), id: context.id };
    }
    const created = await checked("pipelines_create", { workspaceId, document: context.document, idempotencyKey: context.id });
    context.input ??= { workspaceId, pipelineId: context.id, expectedGraphRevision: created.record.graphRevision };
    if (!context.fingerprint) { const preview = await checked("runs_preflight", context.input); if (preview.issues.length) throw new Error(JSON.stringify(preview.issues)); context.fingerprint = preview.fingerprint; }
    const run = await checked("runs_start", { ...context.input, expectedFingerprint: context.fingerprint, idempotencyKey: context.runKey });
    if (!mounted.current) return;
    setTestRun(run.id); testContext.current = null;
    onNotice(tx("本地诊断已启动：包含正常计算与预期失败测试。", "Local diagnostic started: checksum and intentional failure test."));
    onMonitor();
  }
  return <section className="mcp-panel" aria-label={tx("MCP 工作台", "MCP workbench")}>
    <div className="mcp-heading"><strong>{tx("平台 MCP", "Platform MCP")}</strong><button disabled={busy} onClick={() => void perform(connect)}>{info ? tx("重新连接", "Reconnect") : tx("连接 MCP", "Connect MCP")}</button></div>
    <p className="mcp-muted">{workspaceId} / {document.id}{selectedId ? ` / ${selectedId}` : ""}</p>
    {info && <p className="mcp-muted">Streamable HTTP · {info.protocolVersion} · {tools.length} {tx("项工具", "tools")} {info.readOnly ? "· Read only" : ""}</p>}
    <nav className="mcp-tabs" aria-label={tx("MCP 功能", "MCP features")}>{[["tools", "工具调试", "Tools"], ["connect", "接入与测试", "Connection & tests"]].map(([id, zh, en]) => <button aria-pressed={tab === id} key={id} onClick={() => setTab(id)}>{tx(zh, en)}</button>)}</nav>
    {error && <p role="alert" className="ide-error">{error}</p>}
    {tab === "tools" && <>
      <input aria-label={tx("筛选 MCP 工具", "Filter MCP tools")} placeholder={tx("搜索工具名称", "Search tools")} value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label={tx("MCP 工具", "MCP tool")} value={name} disabled={busy} onChange={e => { const item = tools.find(t => t.name === e.target.value); if (item) seed(item); }}>{tools.filter(t => `${t.name} ${t.title ?? ""}`.toLowerCase().includes(query.toLowerCase())).map(t => <option key={t.name} value={t.name}>{t.title ?? t.name}</option>)}</select>
      <p>{tool?.description}</p>
      {tool && <p className="mcp-muted">MCP: <code>{tool.name}</code></p>}
      <details><summary>{tx("参数与返回契约", "Input / output schemas")}</summary><pre>{JSON.stringify({ input: tool?.inputSchema, output: tool?.outputSchema }, null, 2)}</pre></details>
      <label>{tx("调用参数 JSON", "Arguments JSON")}<textarea aria-label={tx("调用参数 JSON", "Arguments JSON")} spellCheck={false} rows={9} value={args} disabled={busy} onChange={e => setArgs(e.target.value)} /></label>
      <p className="mcp-muted">{tx("写操作使用当前版本和幂等键。超时后先读取状态；重试同一请求保留原键。", "Use current revisions and an idempotency key for writes. Read state after a timeout; retain the key when retrying the same request.")}</p>
      <button disabled={busy || !tool} onClick={() => void perform(async () => { const input: unknown = JSON.parse(args); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Arguments must be an object"); await invoke(name, input as Record<string, unknown>); })}>{tool?.annotations?.readOnlyHint ? tx("调用工具", "Call tool") : tx("确认执行写操作", "Confirm write operation")}</button>
    </>}
    {tab === "connect" && <>
      <label>MCP endpoint<input readOnly value={`${window.location.origin}/studio-mcp`} /></label>
      <p>{tx("外部客户端使用 Streamable HTTP 和专用 Bearer 凭据。团队模式可在账号菜单创建 24 小时凭据；本地模式在服务端配置 STUDIO_LOCAL_API_TOKEN。浏览器会话 token 不用于外部客户端。", "External clients use Streamable HTTP with a dedicated Bearer token. Team users can issue a 24-hour token in Account; local mode uses server-configured STUDIO_LOCAL_API_TOKEN. Never export the browser session token.")}</p>
      <p>{tx("AI 对话、模型配置与权限审批统一由 AI Assistant 的 Navigator 会话管理。此面板只执行你填写并确认的工具参数。", "AI Assistant uses Navigator for conversation, models and approvals. This panel executes tool arguments that you enter and confirm.")}</p>
      <p className="mcp-muted">{tx("本地诊断配置：在控制服务设置 STUDIO_LOCAL_DIAGNOSTICS=1 后重启服务。", "Local diagnostic setup: configure STUDIO_LOCAL_DIAGNOSTICS=1 and restart control.")}</p>
      <h4>{tx("本地测试流程", "Local test workflow")}</h4><p>{tx("创建独立流程，运行两个逐步 SHA-256 任务：一个成功，一个按配置预期失败。状态和事件走实际运行服务；不使用 GPU、不伪造训练指标，也不覆盖当前草稿。", "Creates a separate workflow with two incremental SHA-256 tasks: one succeeds, one intentionally fails. Uses the real run service and events; no GPU or fabricated training metrics. Keeps the current draft.")}</p>
      {!info?.diagnostics && <p>{tx("需在服务端启用 STUDIO_LOCAL_DIAGNOSTICS=1", "Enable STUDIO_LOCAL_DIAGNOSTICS=1 on the server")}</p>}
      <button disabled={busy || !info?.diagnostics || info.readOnly || !scopes.includes("runs.write") || !scopes.includes("pipelines.write")} onClick={() => void perform(diagnostic)}>{tx("创建并运行本地诊断", "Create and run local diagnostic")}</button>
      {testRun && <p>{tx("运行", "Run")}: <code>{testRun}</code> <button onClick={onMonitor}>Navigator</button></p>}
      <p className="mcp-muted">{actorId} · {scopes.join(", ")}</p>
    </>}
    {!!entries.length && <details open><summary>{tx("工具调用记录", "Tool call history")} ({entries.length})</summary>{entries.map((entry, index) => <details key={entry.id} open={index === 0}><summary>{entry.name}</summary><pre aria-label={index === 0 ? tx("MCP 调用结果", "MCP call result") : undefined}>{JSON.stringify({ input: entry.input, result: entry.result }, null, 2)}</pre></details>)}</details>}
  </section>;
}
