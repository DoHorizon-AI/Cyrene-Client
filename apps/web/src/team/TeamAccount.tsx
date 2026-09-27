import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useI18n } from "../i18n";
import { useTeamAccount } from "./TeamGate";

const tokensSchema = z.object({ items: z.array(z.object({ id: z.string(), expiresAt: z.number(), scopes: z.array(z.string()) })) });
const membersSchema = z.object({ items: z.array(z.object({ id: z.string(), username: z.string(), roles: z.array(z.string()), workspaceIds: z.array(z.string()), disabled: z.boolean() })) });

export function TeamAccount() {
  const account = useTeamAccount(), { locale, t } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tokenMode, setTokenMode] = useState("read"), [token, setToken] = useState("");
  const [tokens, setTokens] = useState<z.infer<typeof tokensSchema>["items"] | null>(null);
  const [members, setMembers] = useState<z.infer<typeof membersSchema>["items"] | null>(null);
  const active = useRef(true), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!account) return null;
  const { session, request, refresh } = account;
  const team = session.mode === "team", admin = !!session.actor?.scopes.includes("team.admin");
  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { if (active.current) setError(e instanceof Error ? e.message : tx("操作失败。", "Operation failed.")); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  async function read(path: "tokens" | "members") {
    const response = await fetch(`/studio-team/v1/${path}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(tx(`读取失败（HTTP ${response.status}），请检查登录状态与权限。`, `Request failed (HTTP ${response.status}). Check sign-in and permissions.`));
    return response.json();
  }
  async function loadTokens() { const result = tokensSchema.parse(await read("tokens")); if (active.current) setTokens(result.items); }
  async function loadMembers() { const result = membersSchema.parse(await read("members")); if (active.current) setMembers(result.items); }
  return <section aria-label={tx("工作台账号管理", "Workbench account management")}>
    <h3>{tx("工作台账号", "Workbench account")}</h3>
    <dl><dt>{tx("运行模式", "Mode")}</dt><dd>{team ? tx("团队账号", "Team accounts") : session.mode === "legacy" ? tx("旧版本地预演", "Legacy local preview") : tx("本地单用户", "Local single user")}</dd><dt>{t("用户名")}</dt><dd>{session.username ?? "local-user"}</dd><dt>{t("工作空间")}</dt><dd>{session.actor?.workspaceIds.join(", ") ?? "local"}</dd></dl>
    <div className="security-actions"><button disabled={busy} onClick={() => void perform(async () => { await refresh(); if (active.current) setNotice(tx("登录状态已刷新。", "Sign-in state refreshed.")); })}>{tx("刷新登录状态", "Refresh sign-in state")}</button>
      {team && <button disabled={busy} onClick={() => void perform(async () => { await request("logout", {}); setToken(""); await refresh(); })}>{t("退出登录")}</button>}
    </div>
    {!team ? <>
      <p>{tx("当前没有启用用户账号系统，local-user 是本机会话标识。成员管理和个人 MCP 凭据需要团队模式。", "User accounts are not enabled. local-user identifies this local session. Team mode is required for members and personal MCP tokens.")}</p>
      <details><summary>{tx("启用团队账号", "Enable team accounts")}</summary><ol>
        <li>{tx("为控制服务配置 PostgreSQL，并设置 STUDIO_MODE=team 与 STUDIO_DATABASE_URL。", "Configure PostgreSQL for the control service and set STUDIO_MODE=team and STUDIO_DATABASE_URL.")}</li>
        <li>{tx("在管理员终端临时设置 STUDIO_ADMIN_USER 和 STUDIO_ADMIN_PASSWORD，运行 npm run team:bootstrap。已有团队不会被覆盖。", "Temporarily set STUDIO_ADMIN_USER and STUDIO_ADMIN_PASSWORD in an administrator terminal, then run npm run team:bootstrap. Existing teams cannot be overwritten.")}</li>
        <li>{tx("重启控制服务后刷新页面，使用初始化的账号登录。请先保存当前流程；不同身份的本地草稿相互隔离。", "Restart the control service and reload this page to sign in. Save your pipeline first; local drafts are isolated by identity.")}</li>
      </ol><p>{tx("部署说明：docs/distributed-control.md。", "Deployment guide: docs/distributed-control.md.")}</p></details>
    </> : <>
      <h3 className="security-subheading">{tx("MCP 访问凭据", "MCP access tokens")}</h3>
      <label>{tx("MCP 凭据权限", "MCP token permissions")}<select value={tokenMode} disabled={busy} onChange={e => setTokenMode(e.target.value)}><option value="read">{tx("只读", "Read only")}</option><option value="all">{tx("当前操作权限", "Current operation permissions")}</option></select></label>
      <div className="security-actions"><button disabled={busy} onClick={() => void perform(async () => {
        const issued = z.object({ token: z.string() }).parse(await request("tokens", { scopes: session.actor!.scopes.filter(s => s !== "team.admin" && (tokenMode === "all" || s.endsWith(".read"))) }));
        if (active.current) setToken(issued.token); await loadTokens();
      })}>{t("创建 MCP 凭据（24 小时）")}</button><button disabled={busy} onClick={() => void perform(loadTokens)}>{tx("查看已签发 MCP 凭据", "List issued MCP tokens")}</button></div>
      {token && <label>{t("仅此处显示，请存入客户端环境变量")}<input readOnly type="password" value={token} onFocus={e => e.target.select()} /><button onClick={() => setToken("")}>{tx("清除显示", "Clear display")}</button></label>}
      {tokens && <ul className="security-list" aria-label={tx("已签发凭据", "Issued tokens")}>{tokens.length === 0 && <li>{tx("没有有效凭据。", "No active tokens.")}</li>}{tokens.map(item => <li key={item.id}><code>{item.id.slice(0, 12)}</code><span>{new Date(item.expiresAt).toLocaleString(locale)}</span><small>{item.scopes.join(", ")}</small><button disabled={busy} onClick={() => void perform(async () => { await request("tokens/revoke", { id: item.id }); setToken(""); await loadTokens(); })}>{tx("撤销凭据", "Revoke token")}</button></li>)}</ul>}
      {admin && <>
        <h3 className="security-subheading">{tx("团队成员", "Team members")}</h3><button disabled={busy} onClick={() => void perform(loadMembers)}>{tx("读取成员列表", "Load members")}</button>
        {members && <ul className="security-list" aria-label={tx("成员列表", "Members")}>{members.map(item => <li key={item.id}><strong>{item.username}</strong><span>{item.roles.map(role => ({ viewer: t("查看"), editor: t("编辑"), operator: t("执行控制"), admin: t("管理") })[role] ?? role).join(", ")}</span><small>{item.workspaceIds.join(", ")}</small></li>)}</ul>}
        <form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, data = new FormData(form); void perform(async () => { await request("members", { username: data.get("username"), password: data.get("password"), workspaceIds: session.actor!.workspaceIds, roles: [data.get("role")] }); if (active.current) { form.reset(); setNotice(tx("成员已添加。", "Member added.")); } await loadMembers(); }); }}>
          <label>{t("新成员用户名")}<input name="username" disabled={busy} required autoComplete="off" /></label><label>{t("新成员初始密码")}<input name="password" disabled={busy} type="password" minLength={12} maxLength={256} required autoComplete="new-password" /></label>
          <label>{t("新成员权限")}<select name="role" disabled={busy}><option value="viewer">{t("查看")}</option><option value="editor">{t("编辑")}</option><option value="operator">{t("执行控制")}</option><option value="admin">{t("管理")}</option></select></label><button disabled={busy}>{t("添加")}</button>
        </form>
      </>}
    </>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
