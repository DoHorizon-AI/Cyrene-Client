import { lazy, Suspense, useRef, useState } from "react";
import type { Pipeline } from "../../../../packages/pipeline-model";
import { Icon } from "./Chrome";
import { useTeamIdentity } from "../team/TeamGate";
import { useI18n } from "../i18n";

export function FilePanel({ document, disabled, onImport, onPreview, onSource, onNotice }: { document: Pipeline; disabled: boolean; onImport(file: File): void; onPreview(name: string, text: string): void; onSource(): void; onNotice(message: string): void }) {
  const { locale, t } = useI18n();
  const input = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null), readVersion = useRef(0);
  const [files, setFiles] = useState<File[]>([]), [query, setQuery] = useState("");
  function add(list: FileList | null) { if (list) { setFiles(Array.from(list).slice(0, 1000)); if (list.length > 1000) onNotice(locale === "zh-CN" ? "当前文件视图最多显示 1000 个文件。" : "The file view displays at most 1,000 files."); } }
  async function read(file: File) {
    const version = ++readVersion.current;
    if (file.size > 1024 * 1024) { onNotice(locale === "zh-CN" ? "预览或导入的单个文件不能超过 1 MB。" : "A file selected for preview or import cannot exceed 1 MB."); return; }
    if (!/\.(json|txt|md|yaml|yml|py|ts|tsx|js|csv|toml|log)$/i.test(file.name)) { onNotice(locale === "zh-CN" ? "此类型暂不支持文本预览。" : "Text preview is not supported for this file type."); return; }
    const text = await file.text();
    if (version === readVersion.current) onPreview(file.webkitRelativePath || file.name, text);
  }
  return <section className="ide-file-panel"><div className="ide-panel-actions"><button disabled={disabled} onClick={() => input.current?.click()}>{t("打开文件")}</button><button disabled={disabled} onClick={() => folder.current?.click()}>{t("打开文件夹")}</button></div>
    <input ref={input} hidden type="file" multiple aria-label={t("选择本地文件")} onChange={e => add(e.target.files)} />
    <input ref={folder} hidden type="file" multiple {...{ webkitdirectory: "" }} aria-label={t("选择本地文件夹")} onChange={e => add(e.target.files)} />
    <input className="search" aria-label={t("筛选本地文件")} placeholder={t("查找文件…")} value={query} onChange={e => setQuery(e.target.value)} />
    <div className="ide-tree-title"><Icon name="folder" /> {t("工作区草稿")}</div><button className="ide-tree-file active" onClick={onSource}><Icon name="files" /><span>{document.id}.json</span></button>
    <div className="ide-tree-title"><Icon name="folder" /> {t("本地文件")} <small>{files.length || t("未打开")}</small></div>
    {!files.length && <p className="ide-panel-note">{t("选择文件或文件夹后在这里浏览。文件仅在当前浏览器会话中读取。")}</p>}
    {files.filter(f => (f.webkitRelativePath || f.name).toLowerCase().includes(query.toLowerCase())).map((file, i) => <div className="ide-file-entry" key={`${file.webkitRelativePath}-${file.name}-${i}`}><button className="ide-tree-file" title={file.webkitRelativePath || file.name} onClick={() => void read(file).catch(() => onNotice(locale === "zh-CN" ? "读取文件失败。" : "Failed to read the file."))}><Icon name="files" /><span>{file.webkitRelativePath || file.name}</span></button>{file.name.endsWith(".json") && <button className="ide-file-import" title={t("将该 JSON 作为流水线导入")} disabled={disabled} onClick={() => onImport(file)}>{t("导入流程")}</button>}</div>)}
  </section>;
}

const McpPanel = lazy(() => import("../mcp/McpPanel"));
export function AssistantPanel(props: { document: Pipeline; selectedId: string | null; onNotice(message: string): void; onMonitor(): void }) {
  const { actorId, workspaceId } = useTeamIdentity();
  return <Suspense fallback={<p>MCP…</p>}><McpPanel key={`${actorId}:${workspaceId}:${props.document.id}`} {...props} /></Suspense>;
}

export function PluginPanel({ onSource, onChecks }: { onSource(): void; onChecks(): void }) {
  const { t } = useI18n();
  return <section className="ide-plugin-panel"><p className="ide-panel-note">{t("内置页面")}</p><button className="ide-plugin-card" onClick={onSource}><Icon name="files" /><span><strong>{t("流程 JSON")}</strong><small>{t("查看当前文档与节点布局")}</small></span><Icon name="chevron" /></button><button className="ide-plugin-card" onClick={onChecks}><Icon name="check" /><span><strong>{t("流程检查")}</strong><small>{t("查看端口、参数与依赖问题")}</small></span><Icon name="chevron" /></button><div className="ide-extension-note"><Icon name="plugins" /><strong>{t("页面扩展")}</strong><p>{t("这里预留评估报告、训练曲线等页面入口。第三方页面插件加载尚未接入。")}</p></div></section>;
}
