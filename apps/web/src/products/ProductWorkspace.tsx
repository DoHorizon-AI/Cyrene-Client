import { useEffect, useState } from "react";
import { ChatPage, DatasetsPage, DeploymentsPage, GatewayPage, ModelsPage, OverviewPage, RunsPage, SettingsPage, TrainingPage } from "../../services/navigator/src/pages";
import { WorkAssistantPage } from "../../services/navigator/src/work-assistant";
import { EchoWorkbench } from "../../services/echo/src/EchoWorkbench";
import { ControlledLocaleProvider } from "../../services/navigator/src/i18n";
import type { RouteId } from "../../services/navigator/src/router";
import { useI18n } from "../i18n";
import { useTeamIdentity } from "../team/TeamGate";
import { useNavigatorSession } from "../services/NavigatorSessionProvider";
import { WorkspaceTrainingConsole } from "./WorkspaceTrainingConsole";
import "./products.css";

export default function ProductWorkspace({ route }: { route: RouteId }) {
  const locale = useI18n(), { actorId, workspaceId } = useTeamIdentity();
  const workspaceTraining = import.meta.env.VITE_WORKSPACE_BFF_ENABLED === "true" && (route === "training" || route === "runs");
  return <ControlledLocaleProvider locale={locale.locale} setLocale={locale.setLocale}>{workspaceTraining
    ? <WorkspaceTrainingConsole key={actorId} route={route} />
    : <ProductSession key={`${actorId}:${workspaceId}`} route={route} />}</ControlledLocaleProvider>;
}
function ProductSession({ route }: { route: RouteId }) {
  const { locale } = useI18n(), { scopes, workspaceId } = useTeamIdentity();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const { api, session, error: sessionError, reconnect, pair, disconnect } = useNavigatorSession();
  const [error, setError] = useState(""), [pairing, setPairing] = useState("");
  const [connectedOnce, setConnectedOnce] = useState(false);
  useEffect(() => { if (session?.authenticated) setConnectedOnce(true); }, [session?.authenticated]);
  const [visited, setVisited] = useState<RouteId[]>([route]), [busy, setBusy] = useState(false);
  useEffect(() => { setVisited(values => values.includes(route) ? values : [...values, route]); }, [route]);
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
      default: return <OverviewPage api={api} />;
    }
  };
  return <div className="product-workspace" onKeyDown={event => event.stopPropagation()}>
    {(error || sessionError) && <p role="alert">{error || sessionError} <button onClick={() => void reconnect().catch(reason => setError(String(reason)))}>{tx("重试连接", "Reconnect")}</button></p>}
    {!session?.authenticated ? <section className="product-connection"><h2>{tx("连接 Product 服务", "Connect Product services")}</h2><p>{tx("运行监控使用 Studio 会话；这些管理页面还需要 Web Host 配对。", "Run monitoring uses your Studio session. These management pages also require Web Host pairing.")}</p><form onSubmit={event => { event.preventDefault(); setBusy(true); void pair(pairing).then(() => { setPairing(""); setError(""); }, reason => setError(String(reason))).finally(() => setBusy(false)); }}><label>{tx("一次性配对码", "One-time pairing code")}<input value={pairing} autoComplete="one-time-code" onChange={event => setPairing(event.target.value)} /></label><button disabled={busy || !pairing.trim()}>{tx("连接", "Connect")}</button></form></section> : <>
      <div className="product-session-bar"><span>{tx("Product 服务已连接", "Product services connected")}</span><button onClick={() => { void disconnect().then(() => setError(""), reason => setError(String(reason))); }}>{tx("断开 Product 会话", "Disconnect Product session")}</button></div>
      {!scopes.includes("products.write") && !scopes.includes("products.operate") && <p>{tx("当前账号仅可读取；提交操作需要编辑或执行权限。", "Read-only account. Changes require edit or execution permission.")}</p>}
    </>}
    {session?.authenticated && connectedOnce && visited.map(id => <div key={id} hidden={id !== route}>{render(id)}</div>)}
  </div>;
}
