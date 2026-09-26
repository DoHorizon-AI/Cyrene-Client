import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { buildCommands, type Build, type BuildProfile } from "../../../../packages/build-control/contracts";
import { catalogCommands } from "../../../../packages/node-registry/commands";
import { controlCommand } from "../services/commands";
import { useTeamIdentity } from "../team/TeamGate";

type Preview = z.infer<typeof buildCommands["builds.preview"]["output"]>;
type Catalog = z.infer<typeof catalogCommands["catalog.list_packages"]["output"]>;
type Activation = z.infer<typeof catalogCommands["catalog.preview_activation"]["output"]>;
const call = <N extends keyof typeof buildCommands>(name: N, input: unknown, key?: string) => controlCommand<z.infer<(typeof buildCommands)[N]["output"]>>("/studio-builds", name, input, key);
const catalog = <N extends keyof typeof catalogCommands>(name: N, input: unknown, key?: string) => controlCommand<z.infer<(typeof catalogCommands)[N]["output"]>>("/studio-catalog", name, input, key);

export function useBuildControl(onNotice: (message: string) => void) {
  const { workspaceId, actorId, scopes } = useTeamIdentity();
  const [profiles, setProfiles] = useState<BuildProfile[]>([]), [profileId, setProfile] = useState(""), [sourceRef, setSource] = useState("");
  const [items, setItems] = useState<Build[]>([]), [build, setBuild] = useState<Build | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [packages, setPackages] = useState<Catalog | null>(null), [activation, setActivation] = useState<{ preview: Activation; buildId: string } | null>(null);
  const [logs, setLogs] = useState<{ sequence: number; message: string }[]>([]), [busy, setBusy] = useState(false);
  const live = useRef({ workspaceId, actorId, profileId, sourceRef, buildId: build?.id }); live.current = { workspaceId, actorId, profileId, sourceRef, buildId: build?.id };
  const alive = useRef(false), pending = useRef(false), keys = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setProfiles([]); setProfile(""); setSource(""); setBuild(null); setItems([]); setPreview(null); setActivation(null); setPackages(null); keys.current.clear(); }, [workspaceId, actorId]);
  const keyFor = (name: string, input: unknown) => { const value = JSON.stringify([workspaceId, actorId, name, input]); if (!keys.current.has(value)) keys.current.set(value, crypto.randomUUID()); return keys.current.get(value)!; };
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); const sent = JSON.stringify(live.current);
    const current = () => alive.current && JSON.stringify(live.current) === sent;
    try { await action(current); } catch (e) { if (current()) onNotice(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    if (!build) return;
    let active = true, polling = false, cursor = 0; setLogs([]);
    async function poll() {
      if (polling) return; polling = true;
      try {
        const [next, events] = await Promise.all([call("builds.get", { workspaceId, buildId: build!.id }), call("builds.read_events", { workspaceId, buildId: build!.id, after: cursor })]);
        if (active) { setBuild(next); cursor = events.cursor; setLogs(rows => [...rows, ...events.items].slice(-200)); }
      } catch { /* Last observation remains visible; a disconnect does not cancel. */ }
      finally { polling = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [build?.id, workspaceId, actorId]);
  const refresh = <button disabled={busy || !scopes.includes("builds.read")} onClick={() => void perform(async current => {
    const [available, builds] = await Promise.all([call("builds.list_profiles", { workspaceId }), call("builds.list", { workspaceId })]);
    if (current()) { setProfiles(available.items); setItems(builds.items); if (!available.items.length) onNotice("管理员尚未配置构建来源，请设置 STUDIO_BUILD_PROFILES_FILE。"); }
  })}>刷新构建任务</button>;
  const previewAction = <button disabled={busy || !profileId || !sourceRef || !scopes.includes("builds.read")} onClick={() => void perform(async current => { const result = await call("builds.preview", { workspaceId, profileId, sourceRef }); if (current()) setPreview(result); })}>预览节点镜像构建</button>;
  const start = <button disabled={busy || !preview || !scopes.includes("builds.write")} onClick={() => void perform(async current => {
    if (!preview) return; const input = { workspaceId, profileId, sourceRef, expectedFingerprint: preview.fingerprint };
    const result = await call("builds.start", input, keyFor("start", input));
    if (current()) { setBuild(result); setItems(rows => [...rows.filter(r => r.id !== result.id), result]); setPreview(null); setActivation(null); onNotice("构建请求已保存。关闭面板不会取消构建。"); }
  })}>提交节点镜像构建</button>;
  const cancel = <button disabled={busy || !build || ["succeeded", "failed", "cancelled", "cancelling"].includes(build.state) || !scopes.includes("builds.write")} onClick={() => void perform(async current => {
    if (!build) return; const input = { workspaceId, buildId: build.id, expectedRevision: build.revision }; const result = await call("builds.cancel", input, keyFor("cancel", input)); if (current()) setBuild(result);
  })}>取消选中构建</button>;
  const listPackages = <button disabled={busy || !scopes.includes("pipelines.read")} onClick={() => void perform(async current => { const result = await catalog("catalog.list_packages", { workspaceId }); if (current()) setPackages(result); })}>读取节点包版本</button>;
  const previewActivation = <button disabled={busy || build?.state !== "succeeded" || !scopes.includes("catalog.write")} onClick={() => void perform(async current => {
    if (!build) return; const state = await catalog("catalog.list_packages", { workspaceId }); if (!current()) return;
    const result = await catalog("catalog.preview_activation", { workspaceId, buildId: build.id, expectedRevision: state.revision });
    if (current()) { setPackages(state); setActivation({ preview: result, buildId: build.id }); }
  })}>预览启用构建版本</button>;
  const activate = <button disabled={busy || !activation || activation.buildId !== build?.id || !scopes.includes("catalog.write")} onClick={() => void perform(async current => {
    if (!activation) return;
    const input = { workspaceId, buildId: activation.buildId, expectedRevision: activation.preview.revision, expectedFingerprint: activation.preview.fingerprint };
    const result = await catalog("catalog.activate", input, keyFor("activate", input));
    if (current()) { setActivation(null); onNotice(`已启用 ${result.packageId}@${result.version}；已有文档和运行保留原版本。`); }
  })}>启用所示节点版本</button>;
  const panel = <section className="run-panel" aria-label="构建与节点版本">
    <div>{refresh}{listPackages}<select aria-label="节点构建来源" disabled={busy} value={profileId} onChange={e => { setProfile(e.target.value); setSource(""); setPreview(null); }}><option value="">选择构建来源</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <select aria-label="构建源码引用" disabled={busy} value={sourceRef} onChange={e => { setSource(e.target.value); setPreview(null); }}><option value="">选择源码引用</option>{profiles.find(p => p.id === profileId)?.sourceRefs.map(ref => <option key={ref}>{ref}</option>)}</select>{previewAction}{start}
    </div>
    {preview && <p>待构建源码：<code>{preview.sourceSha}</code> · 镜像：{preview.profile.imageRepository} · 构建工作流：<code>{preview.workflowSha}</code></p>}
    <select aria-label="构建任务" disabled={busy} value={build?.id ?? ""} onChange={e => { const found = items.find(b => b.id === e.target.value); setBuild(found ?? null); setActivation(null); }}><option value="">选择构建任务</option>{items.map(item => <option key={item.id} value={item.id}>{item.profile.title} · {item.state} · {item.id.slice(0, 8)}</option>)}</select>
    {build && <><p>{build.id} · {build.state} · v{build.revision} · {build.message}</p>{build.workflowUrl && <a href={build.workflowUrl} target="_blank" rel="noreferrer">打开 GitHub 构建日志</a>}<p><code>{build.result?.image}</code></p>{cancel}{previewActivation}{activate}<details open><summary>构建事件</summary>{logs.map(event => <p key={event.sequence}>{event.sequence} · {event.message}</p>)}</details></>}
    {activation && <p>将启用 {activation.preview.package.id}@{activation.preview.package.version}；替换：{activation.preview.replacing.join(", ") || "无"}。原版本继续保留。</p>}
    {packages && <details open><summary>节点包 · 目录 v{packages.revision}</summary>{packages.packages.map(pkg => <p key={`${pkg.id}@${pkg.version}`}>{pkg.id}@{pkg.version} · {packages.active.includes(`${pkg.id}@${pkg.version}`) ? "已启用" : "保留版本"}</p>)}</details>}
    <p>构建使用管理员配置的 GitHub Actions。构建成功后需管理员显式启用节点版本。</p>
  </section>;
  return { panel, menu: <>{refresh}{previewAction}{start}{cancel}<hr />{listPackages}{previewActivation}{activate}</> };
}
