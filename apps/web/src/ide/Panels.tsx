import { useRef, useState } from "react";
import type { Pipeline } from "../../../../packages/pipeline-model";
import { Icon } from "./Chrome";

export function FilePanel({ document, disabled, onImport, onPreview, onSource, onNotice }: { document: Pipeline; disabled: boolean; onImport(file: File): void; onPreview(name: string, text: string): void; onSource(): void; onNotice(message: string): void }) {
  const input = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null), readVersion = useRef(0);
  const [files, setFiles] = useState<File[]>([]), [query, setQuery] = useState("");
  function add(list: FileList | null) { if (list) { setFiles(Array.from(list).slice(0, 1000)); if (list.length > 1000) onNotice("当前文件视图最多显示 1000 个文件。"); } }
  async function read(file: File) {
    const version = ++readVersion.current;
    if (file.size > 1024 * 1024) { onNotice("预览或导入的单个文件不能超过 1 MB。"); return; }
    if (!/\.(json|txt|md|yaml|yml|py|ts|tsx|js|csv|toml|log)$/i.test(file.name)) { onNotice("此类型暂不支持文本预览。"); return; }
    const text = await file.text();
    if (version === readVersion.current) onPreview(file.webkitRelativePath || file.name, text);
  }
  return <section className="ide-file-panel"><div className="ide-panel-actions"><button disabled={disabled} onClick={() => input.current?.click()}>打开文件</button><button disabled={disabled} onClick={() => folder.current?.click()}>打开文件夹</button></div>
    <input ref={input} hidden type="file" multiple aria-label="选择本地文件" onChange={e => add(e.target.files)} />
    <input ref={folder} hidden type="file" multiple {...{ webkitdirectory: "" }} aria-label="选择本地文件夹" onChange={e => add(e.target.files)} />
    <input className="search" aria-label="筛选本地文件" placeholder="查找文件…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="ide-tree-title"><Icon name="folder" /> 工作区草稿</div><button className="ide-tree-file active" onClick={onSource}><Icon name="files" /><span>{document.id}.json</span></button>
    <div className="ide-tree-title"><Icon name="folder" /> 本地文件 <small>{files.length || "未打开"}</small></div>
    {!files.length && <p className="ide-panel-note">选择文件或文件夹后在这里浏览。文件仅在当前浏览器会话中读取。</p>}
    {files.filter(f => (f.webkitRelativePath || f.name).toLowerCase().includes(query.toLowerCase())).map((file, i) => <div className="ide-file-entry" key={`${file.webkitRelativePath}-${file.name}-${i}`}><button className="ide-tree-file" title={file.webkitRelativePath || file.name} onClick={() => void read(file).catch(() => onNotice("读取文件失败。"))}><Icon name="files" /><span>{file.webkitRelativePath || file.name}</span></button>{file.name.endsWith(".json") && <button className="ide-file-import" title="将该 JSON 作为流水线导入" disabled={disabled} onClick={() => onImport(file)}>导入流程</button>}</div>)}
  </section>;
}

export function AssistantPanel({ document, selectedId, onNotice }: { document: Pipeline; selectedId: string | null; onNotice(message: string): void }) {
  const [prompt, setPrompt] = useState(""), [tools, setTools] = useState<{ name: string; readOnly: boolean }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function loadTools() {
    setBusy(true); setError("");
    try { const response = await fetch("/studio-pipelines/v1/session", { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error("控制服务不可用。"); const data = await response.json(); if (!Array.isArray(data.commands) || data.commands.some((t: any) => typeof t.name !== "string" || typeof t.readOnly !== "boolean")) throw new Error("工具目录格式不匹配。"); setTools(data.commands); }
    catch (e) { setError(e instanceof Error ? e.message : "无法读取工具目录。"); } finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`请通过 Cyrene Studio MCP 操作工作空间 local 中的流程 ${document.id}。${selectedId ? `当前选中节点：${selectedId}。` : ""}\n先读取服务端最新版本并校验。\n\n${prompt}`); onNotice("任务与流程上下文已复制，可粘贴到已连接 Studio MCP 的 AI 客户端。"); }
    catch { onNotice("剪贴板不可用，可手动选择任务文字复制。"); }
  }
  return <section className="ide-assistant"><div className="ide-assistant-head"><Icon name="assistant" /><h3>一起构建下一步</h3><p>把想法变成可编辑的流水线。</p></div>
    <div className="ide-context-chip"><Icon name="nodes" /><span>{document.id}</span></div>{selectedId && <div className="ide-context-node">节点上下文 · {selectedId}</div>}
    <div className="ide-assistant-note"><span className="ide-status-dot" /> MCP 编辑工具已提供<p>内置对话模型尚未配置。先将当前流程保存到服务端，再将任务复制到已连接 Studio MCP 的 AI 客户端。没有本地冲突时，画布会同步服务端修改。</p></div>
    <button className="ide-text-action" disabled={busy} onClick={() => void loadTools()}>{busy ? "读取中…" : "查看可用工具"}</button>
    {!!tools.length && <div className="ide-tool-list">{tools.map(t => <div key={t.name}><code>{t.name}</code><small>{t.readOnly ? "读取" : "编辑"}</small></div>)}</div>}{error && <p className="ide-error">{error}</p>}
    <div className="ide-prompt-box"><label htmlFor="assistant-task">任务草稿</label><textarea id="assistant-task" value={prompt} maxLength={4000} onChange={e => setPrompt(e.target.value)} placeholder="例如：添加第二组训练参数对比，保留现有节点位置…" /><div><span>附带流程与节点引用</span><button disabled={!prompt.trim()} onClick={() => void copy()}>复制任务与上下文 ↗</button></div></div>
    <small className="ide-assistant-footer">当前面板不会发送模型请求或执行训练。</small>
  </section>;
}

export function PluginPanel({ onSource, onChecks }: { onSource(): void; onChecks(): void }) {
  return <section className="ide-plugin-panel"><p className="ide-panel-note">内置页面</p><button className="ide-plugin-card" onClick={onSource}><Icon name="files" /><span><strong>流程 JSON</strong><small>查看当前文档与节点布局</small></span><Icon name="chevron" /></button><button className="ide-plugin-card" onClick={onChecks}><Icon name="check" /><span><strong>流程检查</strong><small>查看端口、参数与依赖问题</small></span><Icon name="chevron" /></button><div className="ide-extension-note"><Icon name="plugins" /><strong>页面扩展</strong><p>这里预留评估报告、训练曲线等页面入口。第三方页面插件加载尚未接入。</p></div></section>;
}
