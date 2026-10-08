import "@fontsource-variable/space-grotesk";
import "../design-tokens.css";
import "./products.css";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { NavigatorApi, type SessionPayload } from "../../services/navigator/src/api";
import { ChatPage, DatasetsPage, DeploymentsPage, GatewayPage, ModelsPage, OverviewPage, RunsPage, SettingsPage, TrainingPage } from "../../services/navigator/src/pages";
import { WorkAssistantPage } from "../../services/navigator/src/work-assistant";
import { EchoWorkbench } from "../../services/echo/src/EchoWorkbench";
import { ControlledLocaleProvider } from "../../services/navigator/src/i18n";
import type { RouteId } from "../../services/navigator/src/router";
import { useI18n } from "../i18n";
import { useTeamIdentity } from "../team/TeamGate";
import { studioProductFetch } from "./transport";
import { WorkspaceTrainingConsole } from "./WorkspaceTrainingConsole";
import { InstallerPage } from "../../services/installer/src/InstallerPage";

export default function ProductWorkspace({ route }: { route: RouteId }) {
  const locale = useI18n(), { actorId, workspaceId } = useTeamIdentity();
  if (route === "installer") {
    return (
      <ControlledLocaleProvider locale={locale.locale} setLocale={locale.setLocale}>
        <div className="product-workspace" onKeyDown={event => event.stopPropagation()} style={{ height: "100%", overflow: "hidden" }}>
          <InstallerPage />
        </div>
      </ControlledLocaleProvider>
    );
  }
  const workspaceTraining = import.meta.env.VITE_WORKSPACE_BFF_ENABLED === "true" && (route === "training" || route === "runs");
  return <ControlledLocaleProvider locale={locale.locale} setLocale={locale.setLocale}>{workspaceTraining
    ? <WorkspaceTrainingConsole key={actorId} route={route} />
    : <ProductSession key={`${actorId}:${workspaceId}`} route={route} />}</ControlledLocaleProvider>;
}
function ProductSession({ route }: { route: RouteId }) {
  const { locale } = useI18n(), { scopes, workspaceId } = useTeamIdentity();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const api = useMemo(() => new NavigatorApi(studioProductFetch), []);
  const [session, setSession] = useState<SessionPayload | null>(null), [error, setError] = useState(""), [pairing, setPairing] = useState("");
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const slot = document.querySelector(".ide-statusbar > div");
    setStatusSlot(slot instanceof HTMLElement ? slot : null);
  }, [session?.authenticated]);
  useEffect(() => { if (session?.authenticated) setConnectedOnce(true); }, [session?.authenticated]);
  const [visited, setVisited] = useState<RouteId[]>([route]), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { setVisited(values => values.includes(route) ? values : [...values, route]); }, [route]);
  useEffect(() => {
    let active = true;
    api.setSessionExpiredHandler(() => { if (active) setSession(value => value ? { ...value, authenticated: false } : null); });
    void api.restoreSession().then(value => { if (active) { setSession(value); setError(""); } }, reason => { if (active) setError(String(reason)); });
    return () => { active = false; api.setSessionExpiredHandler(null); };
  }, [api, retry]);
  useEffect(() => {
    if (!session?.authenticated || !session.expiresAt) return;
    let active = true;
    const timer = setTimeout(() => { void api.refreshSession().then(value => { if (active) setSession(value); }, reason => { if (active) { setError(String(reason)); setSession(value => value ? { ...value, authenticated: false } : null); } }); }, Math.min(2_147_483_647, Math.max(1000, Date.parse(session.expiresAt) - Date.now() - 30000)));
    return () => { active = false; clearTimeout(timer); };
  }, [session, api]);
  const render = (id: RouteId) => {
    switch (id) {
      case "models": return <ModelsPage api={api} />;
      case "datasets": return <DatasetsPage api={api} />;
      case "echo": return <EchoWorkbench api={api} />;
      case "training": return <TrainingPage api={api} />;
      case "runs": return <RunsPage api={api} />;
      case "deployments": return <DeploymentsPage api={api} />;
      case "gateway": return <GatewayPage api={api} />;
      case "chat": return <ChatPage api={api} />;
      case "assistant": return <WorkAssistantPage api={api} workspaceId={workspaceId} canOperate={scopes.includes("products.operate")} canWrite={scopes.includes("products.write")} />;
      case "settings": return session && <SettingsPage api={api} session={session} />;
      case "installer": return <InstallerPage />;
      default: return <OverviewPage api={api} />;
    }
  };
  return <div className="product-workspace" onKeyDown={event => event.stopPropagation()}>
    {error && <p className="dh-notice dh-notice--danger product-alert" role="alert">{error} <button className="button button--quiet" onClick={() => setRetry(value => value + 1)}>{tx("重试连接", "Reconnect")}</button></p>}
    {!session?.authenticated ? <section className="product-connection"><h2>{tx("连接 Product 服务", "Connect Product services")}</h2><p>{tx("运行监控使用 Studio 会话；这些管理页面还需要 Web Host 配对。", "Run monitoring uses your Studio session. These management pages also require Web Host pairing.")}</p><form onSubmit={event => { event.preventDefault(); setBusy(true); void api.pair(pairing).then(value => { setSession(value); setPairing(""); setError(""); }, reason => setError(String(reason))).finally(() => setBusy(false)); }}><label>{tx("一次性配对码", "One-time pairing code")}<input value={pairing} autoComplete="one-time-code" onChange={event => setPairing(event.target.value)} /></label><button className="button button--primary" disabled={busy || !pairing.trim()} aria-busy={busy || undefined}>{tx("连接", "Connect")}</button></form></section> : <>
      {statusSlot ? createPortal(<span className="product-session-chip"><span>{tx("Product 已连接", "Product connected")}</span><button type="button" onClick={() => { void api.logout().then(() => setSession(null), reason => setError(String(reason))); }}>{tx("断开", "Disconnect")}</button></span>, statusSlot) : <div className="product-session-bar"><span>{tx("Product 已连接", "Product connected")}</span><button className="button button--quiet" onClick={() => { void api.logout().then(() => setSession(null), reason => setError(String(reason))); }}>{tx("断开", "Disconnect")}</button></div>}
      {!scopes.includes("products.write") && !scopes.includes("products.operate") && <p className="dh-notice product-readonly">{tx("当前账号仅可读取；提交操作需要编辑或执行权限。", "Read-only account. Changes require edit or execution permission.")}</p>}
    </>}
    {session?.authenticated && connectedOnce && visited.map(id => <div key={id} hidden={id !== route}>{render(id)}</div>)}
  </div>;
}
