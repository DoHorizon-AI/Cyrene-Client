import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LanguageSelect, useI18n } from "../i18n";

interface Session { mode: string; authenticated: boolean; username?: string; token?: string; actor?: { id: string; workspaceIds: string[]; scopes: string[] } }
const legacyScopes = ["pipelines.read", "pipelines.write", "servers.read", "servers.write"];
const SessionContext = createContext({ actorId: "local-user", workspaceId: "local", scopes: legacyScopes });
export const useTeamIdentity = () => useContext(SessionContext);
const AccountContext = createContext<{ session: Session; refresh(): Promise<void>; request(path: "tokens" | "tokens/revoke" | "members" | "logout", body: unknown): Promise<unknown> } | null>(null);
export const useTeamAccount = () => useContext(AccountContext);
export function TeamGate({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const [session, setSession] = useState<Session | null>(null), [error, setError] = useState("");
  const [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const response = await fetch("/studio-team/v1/session", { credentials: "same-origin", signal: AbortSignal.timeout(10000) });
    // Compatibility with the explicitly selected legacy Vite bridge only.
    if (response.status === 404 || !response.headers.get("content-type")?.includes("application/json")) { setSession({ mode: "legacy", authenticated: true }); return; }
    if (!response.ok) throw new Error(locale === "zh-CN" ? "无法连接团队控制服务。" : "Unable to connect to the team control service.");
    setSession(await response.json());
  }
  useEffect(() => { let live = true; void refresh().catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  async function request(path: string, body: unknown) {
    const response = await fetch(`/studio-team/v1/${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-studio-control-token": session?.token ?? "" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? (locale === "zh-CN" ? "操作失败。" : "Operation failed.")); return result;
  }
  async function perform(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  if (!session || !session.authenticated) return <main style={{ maxWidth: 420, margin: "12vh auto", padding: 24 }}><div style={{ display: "flex", justifyContent: "flex-end" }}><LanguageSelect /></div><h1>Cyrene Studio</h1><p>{t("登录团队工作空间")}</p><form onSubmit={e => { e.preventDefault(); void perform(async () => { await request("login", { username, password }); setPassword(""); await refresh(); }); }}>
    <label>{t("用户名")}<input aria-label={t("团队用户名")} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /></label>
    <label>{t("密码")}<input aria-label={t("团队密码")} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button disabled={busy || !session}>{t("登录")}</button><button type="button" onClick={() => void perform(refresh)}>{t("重新连接")}</button>
  </form>{error && <p role="alert">{error}</p>}</main>;
  return <SessionContext.Provider value={{ actorId: session.actor?.id ?? "local-user", workspaceId: session.actor?.workspaceIds[0] ?? "local", scopes: session.actor?.scopes ?? legacyScopes }}>
    <AccountContext.Provider key={`${session.mode}:${session.actor?.id ?? "local-user"}`} value={{ session, refresh, request }}>{children}</AccountContext.Provider>
    {session.mode === "team" && <div style={{ position: "fixed", right: 12, bottom: 2, zIndex: 50 }}><button onClick={() => window.dispatchEvent(new Event("cyrene:open-account"))}>{session.username} · {t("账号")}</button></div>}
  </SessionContext.Provider>;
}
