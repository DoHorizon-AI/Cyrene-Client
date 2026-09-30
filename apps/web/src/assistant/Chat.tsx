import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import type { Pipeline } from '../../../../packages/pipeline-model';
import type { PipelineRecord } from '../../../../packages/pipeline-control/contracts';
import { changedWorkflow, workflowContext } from './workflow';
import { useI18n } from '../i18n';
import { assistantRequest as api } from './client';
import type { AssistantEvent, Attachment, HostInfo, Permission, Session } from './types';
import ProviderSettings from './ProviderSettings';
const McpPanel = lazy(() => import('../mcp/McpPanel'));

function Transcript({ events, decide, openWorkflow, tx }: { events: AssistantEvent[]; decide(id: string, allow: boolean, forAll?: boolean): void; openWorkflow(id: string): void; tx(zh: string,en: string): string }) {
  const rows: AssistantEvent[] = [], index = new Map<string, number>();
  const resolved = new Set(events.filter(e => e.type === 'approval-resolved').map(e => String(e.data.id)));
  const latestWorkflow = new Map<string, number>();
  for (const event of events) { const record = changedWorkflow(event); if (record) latestWorkflow.set(`${event.turnId}:${record.document.id}`, event.seq); }
  for (const event of events) {
    if (['status', 'approval-resolved'].includes(event.type)) continue;
    const id = `${event.turnId}:${event.type}:${event.data.id ?? event.seq}`;
    const found = index.get(id);
    if (found !== undefined && ['text', 'summary', 'tool'].includes(event.type)) {
      const old = rows[found]; rows[found] = { ...event, data: { ...event.data, text: event.data.delta ? String(old.data.text ?? '') + String(event.data.text ?? '') : event.data.text } };
    } else { index.set(id, rows.length); rows.push(event); }
  }
  return <>{rows.map(event => <article key={`${event.type}:${event.data.id ?? event.seq}:${event.turnId}`} className={`assistant-message ${event.type}`}>
    {event.type === 'user' && <><strong>{tx('你', 'You')}</strong><p>{String(event.data.text ?? '')}</p>{Array.isArray(event.data.attachments) && <small>{event.data.attachments.map(a => (a as Attachment).name).join(' · ')}</small>}{!!event.data.context && <details><summary>{tx('已附加上下文', 'Attached context')}</summary><pre>{String(event.data.context)}</pre></details>}</>}
    {event.type === 'text' && <Markdown text={String(event.data.text ?? '')} tx={tx} />}
    {event.type === 'user' && !!event.data.workflow && <details><summary>{tx('发送时的流程快照', 'Workflow snapshot when sent')}</summary><pre>{JSON.stringify(event.data.workflow, null, 2)}</pre></details>}
    {event.type === 'summary' && <details><summary>{tx('思考摘要', 'Reasoning summary')}</summary><p>{String(event.data.text ?? '')}</p></details>}
    {event.type === 'tool' && <><details><summary>⌘ {String(event.data.name ?? 'Tool')} <small>{String(event.data.status ?? '')}</small></summary><pre>{JSON.stringify(event.data.detail ?? event.data, null, 2)}</pre></details>{(() => { const record = changedWorkflow(event); return record && latestWorkflow.get(`${event.turnId}:${record.document.id}`) === event.seq ? <div className="assistant-workflow-result"><span>{tx('已保存流程', 'Workflow saved')}: {record.document.name} · v{record.graphRevision}</span><button onClick={() => openWorkflow(record.document.id)}>{tx('在画布中查看', 'View in canvas')}</button></div> : null; })()}</>}
    {event.type === 'error' && <p role="alert">{String(event.data.message)}</p>}
    {event.type === 'approval' && <><strong>{tx('等待确认', 'Approval required')}: {String(event.data.title)}</strong><pre>{JSON.stringify(event.data.detail, null, 2)}</pre>{resolved.has(String(event.data.id)) ? <small>{tx('已处理', 'Resolved')}</small> : <div className="assistant-actions"><button onClick={() => decide(String(event.data.id), true)}>{tx('允许本次', 'Allow once')}</button><button onClick={() => decide(String(event.data.id), true, true)}>{tx('允许本轮全部', 'Allow for all')}</button><button onClick={() => decide(String(event.data.id), false)}>{tx('拒绝', 'Decline')}</button></div>}</>}
  </article>)}</>;
}

export default function Chat(props: { visible?: boolean; document: Pipeline; serverBase: PipelineRecord | null; selectedId: string | null; expanded: boolean; onDock(): void; onOpenWorkflow(id: string): Promise<void>; onNotice(message: string): void; onMonitor(): void }) {
  const { locale } = useI18n(), tx = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  const [info, setInfo] = useState<HostInfo | null>(null), [error, setError] = useState(''), [view, setView] = useState('chat');
  const [sessions, setSessions] = useState<Session[]>([]), [session, setSession] = useState<Session | null>(null), [events, setEvents] = useState<AssistantEvent[]>([]);
  const [draft, setDraft] = useState(''), [attachments, setAttachments] = useState<Attachment[]>([]), [context, setContext] = useState<{label: string; text: string} | null>(null);
  const [runtime, setRuntime] = useState<Session['runtime']>('harness'), [providerId, setProviderId] = useState(''), [model, setModel] = useState(''), [effort, setEffort] = useState(''), [permission, setPermission] = useState<Permission>('ask');
  const [cwd, setCwd] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [title, setTitle] = useState('');
  const files = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null), follow = useRef(true), current = useRef(''), sending = useRef(false);
  const pollWake = useRef<() => void>(() => {});
  const [pollError, setPollError] = useState('');
  const mounted = useRef(true), pendingSend = useRef<{ sessionId: string; requestId: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fail = (e: unknown) => { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); };
  async function refresh() { const [host, list] = await Promise.all([api<HostInfo>('/info'), api<Session[]>('/sessions')]); if (!mounted.current) return; setInfo(host); setSessions(list); setCwd(old => old || host.cwd); setProviderId(old => old || host.providers[0]?.id || ''); }
  useEffect(() => { void refresh().catch(fail); }, []);
  const provider = info?.providers.find(p => p.id === providerId);
  const runtimeInfo = info?.runtimes.find(r => r.id === runtime);
  const models = runtime === 'harness' ? provider?.models ?? [] : runtimeInfo?.models ?? [];
  const selectedModel = models.find(m => m.id === model);
  useEffect(() => { if (!models.some(m => m.id === model)) setModel(models[0]?.id ?? ''); }, [JSON.stringify(models), model]);
  useEffect(() => { if (!selectedModel?.efforts.includes(effort)) setEffort(''); }, [model, JSON.stringify(selectedModel?.efforts), effort]);
  useEffect(() => {
    setPollError('');
    if (!session) return;
    let active = true, pending = false, cursor = 0, failures = 0, lastError = '';
    let timer: ReturnType<typeof setTimeout>;
    const sessionId = session.id;
    const visible = () => props.visible !== false && view === 'chat' && document.visibilityState !== 'hidden';
    const update = async () => {
      clearTimeout(timer);
      if (pending || !active) return;
      if (!visible()) { timer = setTimeout(() => void update(), 30_000); return; }
      pending = true;
      let delay = 10_000;
      try {
        const result = await api<{ session: Session; events: AssistantEvent[] }>(`/sessions/${sessionId}/events?after=${cursor}`);
        if (!active) return;
        failures = 0; lastError = ''; setPollError('');
        setSession(result.session); setEvents(old => { const known = new Set(old.map(e => e.seq)); return [...old, ...result.events.filter(e => !known.has(e.seq))]; });
        if (result.events.length) cursor = result.events.at(-1)!.seq;
        if (pendingSend.current?.sessionId === sessionId && result.events.some(e => e.requestId === pendingSend.current?.requestId)) pendingSend.current = null;
        delay = result.session.state === 'running' || pendingSend.current ? 900 : 10_000;
      } catch (e) {
        delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5));
        const message = e instanceof Error ? e.message : String(e);
        if (active && message !== lastError) { lastError = message; setPollError(message); }
      } finally {
        pending = false;
        if (active) timer = setTimeout(() => void update(), delay);
      }
    };
    const wake = () => { if (visible()) void update(); };
    pollWake.current = wake;
    document.addEventListener('visibilitychange', wake);
    void update();
    return () => { active = false; clearTimeout(timer); pollWake.current = () => {}; document.removeEventListener('visibilitychange', wake); };
  }, [session?.id, props.visible, view]);
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [events]);
  function select(value: Session | null) { if (value && current.current === value.id) { setView('chat'); return; } if (!value) pendingSend.current = null; current.current = value?.id ?? ''; setSession(value); setEvents([]); setTitle(value?.title ?? ''); follow.current = true; if (value) { setRuntime(value.runtime); setProviderId(value.providerId ?? ''); setCwd(value.cwd); setPermission(value.permission); } setView('chat'); }
  async function send() {
    if (sending.current || !draft.trim() || session?.state === 'running') return;
    if (pendingSend.current) { setError(tx('上次发送尚未确认。请等待事件恢复，或在历史记录中核对后新建聊天。', 'The previous submission is unconfirmed. Wait for events to reconnect, or review history before starting a new chat.')); return; }
    sending.current = true; setBusy(true); setError('');
    const text = draft, submittedAttachments = attachments, submittedContext = context, identity = current.current;
    const workflow = workflowContext(props.document, props.serverBase, props.selectedId);
    try {
      let target = session;
      if (!target) { target = await api<Session>('/sessions', { requestId: crypto.randomUUID(), runtime, ...(runtime === 'harness' ? {providerId} : {}), cwd, permission }); if (current.current !== identity) return; select(target); }
      const requestId = crypto.randomUUID(); pendingSend.current = {sessionId: target.id, requestId};
      await api(`/sessions/${target.id}/turns`, { requestId, text, model, ...(effort ? {effort} : {}), permission, workflow, attachments: submittedAttachments.map(a => a.id), ...(submittedContext ? {context: submittedContext.text} : {}) });
      pendingSend.current = null; pollWake.current();
      if (current.current === target.id) { setDraft(old => old === text ? '' : old); setAttachments(old => old.filter(a => !submittedAttachments.some(s => s.id === a.id))); setContext(old => old === submittedContext ? null : old); follow.current = true; }
      void refresh().catch(fail);
    } catch (e) { const status = (e as {status?:number}).status; if (status && status < 500) pendingSend.current = null; fail(e); } finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  async function upload(list: FileList | File[]) {
    const batch = Array.from(list); if (attachments.length + batch.length > 12) throw new Error(tx('最多附加 12 个文件', 'At most 12 attachments'));
    for (const file of batch) {
      if (file.size > 4 * 1024 * 1024) throw new Error(tx('单个附件不能超过 4 MB', 'Each attachment must be at most 4 MB'));
      const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file); });
      const item = await api<Attachment>('/attachments', { name: file.name, mediaType: file.type || 'text/plain', data });
      if (mounted.current) setAttachments(old => [...old, item]);
    }
  }
  const run = (action: () => Promise<unknown>) => void action().then(() => pollWake.current()).catch(fail);
  return <section className="assistant-window" aria-label="AI Assistant" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); run(() => upload(e.dataTransfer.files)); } }}>
    <header className="assistant-heading"><strong title={session?.title}>{session?.title || 'AI Assistant'}</strong><button title={tx('新建聊天', 'New chat')} aria-label={tx('新建聊天', 'New chat')} disabled={busy} onClick={() => select(null)}>＋</button><button title={tx('历史记录', 'History')} aria-label={tx('历史记录', 'History')} onClick={() => {setView(view === 'history' ? 'chat' : 'history'); run(refresh);}}>◷</button><button title={tx('设置', 'Settings')} aria-label={tx('助手设置', 'Assistant settings')} onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}>⚙</button><button title={tx('MCP 调试', 'MCP tools')} onClick={() => setView(view === 'mcp' ? 'chat' : 'mcp')}>MCP</button><button title={props.expanded ? tx('停靠右侧', 'Dock right') : tx('在主页面打开', 'Open in editor')} aria-label={props.expanded ? tx('停靠右侧', 'Dock right') : tx('在主页面打开', 'Open in editor')} onClick={props.onDock}>{props.expanded ? '⇥' : '↗'}</button></header>
    {(error || pollError) && <div className="assistant-error" role="alert">{error || pollError}<button aria-label={tx('关闭错误', 'Dismiss error')} onClick={() => {setError('');setPollError('');}}>×</button></div>}
    {view !== 'chat' && <button className="assistant-back" onClick={() => setView('chat')}>← {tx('返回聊天', 'Back to chat')}</button>}
    <div className="assistant-aux" hidden={view !== 'mcp'}><Suspense fallback={<p>MCP…</p>}><McpPanel key={props.document.id} {...props} /></Suspense></div>
    {view === 'settings' && <div className="assistant-aux"><label>{tx('本机工作目录', 'Local working directory')}<input value={cwd} disabled={!!session} onChange={e => setCwd(e.target.value)} /></label><p className="assistant-muted">{tx('新建聊天时授权此目录。已有聊天保留原目录。', 'New chats use this directory. Existing chats keep their original directory.')}</p><ProviderSettings providers={info?.providers ?? []} tx={tx} onSave={refresh} />{info?.runtimes.map(r => <p key={r.id}><strong>{r.id}</strong> · {r.available ? tx('可用', 'Available') : r.reason}</p>)}<button onClick={() => run(refresh)}>{tx('重新检测', 'Check again')}</button></div>}
    {view === 'history' && <div className="assistant-aux"><input aria-label={tx('搜索聊天', 'Search chats')} placeholder={tx('搜索聊天…', 'Search chats…')} value={search} onChange={e => setSearch(e.target.value)} />{sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase())).map(s => <div className="assistant-history" key={s.id}><button onClick={() => select(s)}><strong>{s.title}</strong><small>{s.runtime} · {new Date(s.updatedAt).toLocaleString()} · {s.state}</small></button><button disabled={s.state === 'running'} aria-label={tx('删除聊天', 'Delete chat')} onClick={() => { if (window.confirm(tx('移除列表和对话显示记录？智能体的执行历史仍保留。', 'Remove this chat from the list? Agent execution history will be retained.'))) run(async () => {await api(`/sessions/${s.id}`, undefined, 'DELETE'); if (session?.id === s.id) select(null); await refresh();}); }}>×</button></div>)}</div>}
    <div className="assistant-conversation" hidden={view !== 'chat'}>
      <div className="assistant-transcript" ref={scroll} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {!events.length && <div className="assistant-empty"><span>✧</span><h2>{tx('一起完成下一步', 'Build your next step')}</h2><p>{tx('选择智能体，提问或编写节点。', 'Choose an agent to ask questions or build nodes.')}</p><button onClick={() => {setDraft(tx('帮我检查当前流程，并解释需要修复的问题。', 'Review this workflow and explain what needs fixing.')); setContext({label: props.document.id, text: JSON.stringify(props.document)});}}>{tx('检查当前流程', 'Review workflow')}</button><button onClick={() => setDraft(tx('在工作目录创建一个节点包，先说明实现和测试方案，再生成代码并运行测试。', 'Create a node package in the working directory. Explain the implementation and tests, then generate the code and run tests.'))}>{tx('编写节点', 'Create a node')}</button></div>}
        <Transcript events={events} tx={tx} openWorkflow={id => run(() => props.onOpenWorkflow(id))} decide={(id, allow, forAll) => { if(session)run(() => api(`/sessions/${session.id}/approvals/${id}`, {allow, ...(forAll ? {forAll:true} : {})})); }} />
      </div>
      {session?.state === 'unknown' && <div className="assistant-error">{tx('上次执行结果待核对。检查本机文件和原生会话后继续。', 'Previous outcome is unknown. Inspect local files and native history before continuing.')}<button onClick={() => run(() => api(`/sessions/${session.id}/reconcile`, {acknowledged:true}))}>{tx('已核对', 'I have checked')}</button></div>}
      <div className="assistant-compose-area"><div className="assistant-composer">
        <div className="assistant-muted">{tx('当前流程', 'Current workflow')}: {props.document.name} · {props.serverBase?.document.id === props.document.id ? `v${props.serverBase.graphRevision}${JSON.stringify(props.document) !== JSON.stringify(props.serverBase.document) ? tx(' · 本地有修改', ' · local changes') : ''}` : tx('尚未保存到服务端', 'Not saved to server')}</div>
        <div className="assistant-chips">{context && <button onClick={() => setContext(null)}>⌗ {context.label} ×</button>}{attachments.map(a => <button key={a.id} onClick={() => setAttachments(old => old.filter(x => x.id !== a.id))}>{a.mediaType.startsWith('image/') ? '▧' : '▤'} {a.name} ×</button>)}</div>
        <textarea aria-label={tx('助手消息', 'Assistant message')} placeholder={tx('提问、描述任务，或粘贴图片…', 'Ask a question, describe a task, or paste an image…')} value={draft} onChange={e => setDraft(e.target.value)} onPaste={e => {const images = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));if(images.length){e.preventDefault();run(() => upload(images));}}} onKeyDown={e => {if(e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229){e.preventDefault();void send();}}} />
        <div className="assistant-compose-tools"><input ref={files} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.yaml,.yml,.py,.ts,.tsx,.js,.toml,.csv,.log" onChange={e => {if(e.target.files)run(() => upload(e.target.files!));e.target.value='';}} /><button title={tx('附加文件', 'Attach files')} aria-label={tx('附加文件', 'Attach files')} onClick={() => files.current?.click()}>＋</button><button onClick={() => setContext({label: props.selectedId ? `${props.document.id} / ${props.selectedId}` : props.document.id, text: JSON.stringify({pipeline: props.document, selectedNodeId: props.selectedId})})}>{tx('流程上下文', 'Workflow context')}</button><select aria-label={tx('权限模式', 'Permissions')} value={permission} onChange={e => setPermission(e.target.value as Permission)}><option value="read-only">{tx('只读', 'Read only')}</option><option value="ask">{tx('写入前确认', 'Confirm writes')}</option><option value="auto">{tx('目录内自动', 'Auto in project')}</option><option value="full-access">{tx('完全访问', 'Full access')}</option></select><span />{session?.state === 'running' ? <button className="assistant-send" aria-label={tx('停止生成', 'Stop generation')} onClick={() => run(() => api(`/sessions/${session.id}/stop`, {}))}>■</button> : <button className="assistant-send" aria-label={tx('发送消息', 'Send message')} disabled={busy || !info || !runtimeInfo?.available || !model || !draft.trim() || session?.state === 'unknown'} onClick={() => void send()}>↑</button>}</div>
      </div><div className="assistant-model-bar"><select aria-label={tx('智能体', 'Agent')} value={runtime} disabled={busy} onChange={e => {select(null);setRuntime(e.target.value as Session['runtime']);}}><option value="harness">Cyrene · API</option><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="cursor">Cursor Agent</option><option value="codebuddy">CodeBuddy Code</option></select>{runtime === 'harness' && <select aria-label={tx('API 提供方', 'API provider')} value={providerId} disabled={!!session} onChange={e => setProviderId(e.target.value)}>{info?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}<select aria-label={tx('模型', 'Model')} value={model} onChange={e => setModel(e.target.value)}><option value="" disabled>{tx('选择模型', 'Select model')}</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>{!!selectedModel?.efforts.length && <select aria-label={tx('思考深度', 'Reasoning effort')} value={effort} onChange={e => setEffort(e.target.value)}><option value="">{tx('默认思考深度', 'Default effort')}</option>{selectedModel.efforts.map(e => <option key={e}>{e}</option>)}</select>}</div>{session?.state === 'running' && <small className="assistant-muted">{tx('正在运行 · 模型和权限修改用于下一轮', 'Running · model and permission changes apply next turn')}</small>}{!runtimeInfo?.available && <p className="assistant-muted">{runtimeInfo?.reason || tx('本机助手尚未连接', 'Local assistant is disconnected')} <button onClick={() => setView('settings')}>{tx('设置', 'Settings')}</button></p>}{runtime === 'harness' && !provider && <button onClick={() => setView('settings')}>{tx('添加 API 提供方', 'Add an API provider')}</button>}
      {!!info?.workspaceId && <small className="assistant-muted">{tx('当前工作空间', 'Current workspace')}: <code>{info.workspaceId}</code></small>}
      {(runtime === 'cursor' || runtime === 'codebuddy') && <small className="assistant-muted">{tx('本机文件与命令还受该 CLI 自身权限配置控制；此处审批处理它交给工作台的请求。', 'Local files and commands also follow the CLI’s own permissions; this window handles requests delegated to it.')}</small>}
      {session && <details className="assistant-session-details"><summary>{tx('会话信息', 'Session details')}</summary><code>{session.nativeId ?? session.id}</code><p>{session.cwd}</p><input aria-label={tx('聊天名称', 'Chat title')} value={title} onChange={e => setTitle(e.target.value)} /><button onClick={() => run(async () => {await api(`/sessions/${session.id}/rename`, {title});await refresh();})}>{tx('重命名', 'Rename')}</button></details>}</div>
    </div>
  </section>;
}
