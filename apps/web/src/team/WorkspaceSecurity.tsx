import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { TeamAccount } from "./TeamAccount";
import { WorkspaceBffClient, WorkspaceBffError, type WorkspaceSummary } from "../services/workspace-bff-client";
import { requestDeviceAssertion, type DeviceApproval } from "../services/workspace-security-contracts";
import "./security.css";

export function WorkspaceSecurity() {
  const { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [client] = useState(() => new WorkspaceBffClient());
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]), [workspace, setWorkspace] = useState("");
  const [code, setCode] = useState(""), [approval, setApproval] = useState<DeviceApproval | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState("");
  const [uncertain, setUncertain] = useState(false), [now, setNow] = useState(Date.now());
  const operation = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; const timer = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; operation.current?.abort(); client.reset(); clearInterval(timer); }; }, [client]);
  const expired = !!approval && Date.parse(approval.challengeExpiresAt) <= now;
  const message = (e: unknown) => {
    if (e instanceof WorkspaceBffError) {
      if (e.status === 401 || e.code === "session_changed") return tx("登录已失效或身份已变化，请登录后重新读取工作空间。", "Your sign-in expired or identity changed. Sign in and reload workspaces.");
      if (e.status === 403) return tx("没有此操作权限，或会话验证已失效。请重新读取后重试。", "Permission denied or session validation expired. Reload before trying again.");
      if (e.status === 503 || e.status === 404) return tx("安全服务尚未配置或此接口尚未开放。", "The security service or this endpoint is not available yet.");
      return `${tx("请求未能完成", "Request could not be completed")} (${e.code}${e.traceId ? ` · ${e.traceId}` : ""})`;
    }
    if (e instanceof Error && ["NotAllowedError", "AbortError"].includes(e.name)) return tx("安全验证已取消或超时，未提交批准。", "Verification was cancelled or timed out. No approval was submitted.");
    return tx("安全验证未完成，请检查浏览器支持、挑战有效期及服务连接。", "Security verification could not complete. Check browser support, challenge expiry and connection.");
  };
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(""); setResult("");
    try { await action(controller.signal); }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { if (operation.current === controller) { operation.current = null; if (alive.current) setBusy(false); } }
  }
  function resetApproval() { setApproval(null); setUncertain(false); setResult(""); }
  async function discover(signal: AbortSignal) {
    // Reauthentication must not discard an approval whose outcome is unknown.
    const pendingWorkspace = uncertain ? approval?.authorization.scope.workspaceId : undefined;
    if (!uncertain) { resetApproval(); setCode(""); }
    setWorkspaces([]); setWorkspace("");
    const items = await client.discoverWorkspaces(signal);
    if (!alive.current) return;
    setWorkspaces(items);
    if (pendingWorkspace) { if (items.some(item => item.workspaceId === pendingWorkspace)) setWorkspace(pendingWorkspace); }
    else if (items.length === 1) setWorkspace(items[0].workspaceId);
  }
  async function complete(signal: AbortSignal, recover = false) {
    if (!approval) return;
    const assertion = recover ? undefined : await requestDeviceAssertion(approval, signal);
    if (!alive.current || signal.aborted) return;
    // Once sent, a lost response is an unknown result, not permission to start again.
    setUncertain(true);
    const response = await client.completeDeviceApproval(approval, assertion, signal);
    if (!alive.current) return;
    setUncertain(false); setCode("");
    const state = response.state;
    setResult(state === "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERED" ? tx("设备凭据已交付；设备在线状态请在服务器管理中核对。", "Device credentials delivered. Check server management for online status.") : state === "DEVICE_AUTHORIZATION_LIFECYCLE_STATE_DELIVERY_PENDING" ? tx("已批准，等待设备领取凭据。", "Approved; waiting for the device to collect credentials.") : tx("已批准，服务端正在签发凭据。", "Approved; the server is issuing credentials."));
    setApproval(null);
  }
  const identity = client.identity;
  return <section className="workspace-security" aria-label={tx("账号与安全", "Account & security")} onKeyDown={e => e.stopPropagation()}>
    <TeamAccount />
    <section><h3>{tx("组织登录", "Organization sign-in")}</h3>
      {!client.enabled ? <><p>{tx("组织登录未配置。它使用独立的组织身份服务，与上方团队账号分开管理。", "Organization sign-in is not configured. It uses a separate identity service from the team accounts above.")}</p><details><summary>{tx("查看组织登录接入条件", "Organization sign-in requirements")}</summary><ol><li>{tx("部署同事实现的 Workspace BFF、Directory 与设备审批提供方。", "Deploy the Workspace BFF, Directory and device approval providers.")}</li><li>{tx("配置 Entra / Easy Auth 及同源 HTTPS 入口，验证令牌范围与后端证书。", "Configure Entra / Easy Auth and a same-origin HTTPS edge with verified token scopes and backend certificates.")}</li><li>{tx("完成后启用前端和边缘 BFF 开关。设备审批还需要已注册的安全密钥。", "Then enable the frontend and edge BFF flags. Device approval also requires an enrolled security key.")}</li></ol><p>{tx("接入说明：docs/workspace-security-integration.md。单独打开前端开关无法启用登录服务。", "Integration guide: docs/workspace-security-integration.md. The frontend flag alone cannot enable sign-in.")}</p></details></> : <>
        <p>{tx("组织身份用于访问授权工作空间和批准设备接入。", "Use your organization identity to access authorized workspaces and approve devices.")}</p>
        <div className="security-actions"><a href="/.auth/login/aad?post_login_redirect_uri=%2F" target="_blank" rel="noopener noreferrer">{tx("在新窗口登录", "Sign in in a new window")}</a><button disabled={busy} onClick={() => void perform(discover)}>{tx("读取登录状态与工作空间", "Load sign-in & workspaces")}</button></div>
        {identity && <dl><dt>{tx("用户", "User")}</dt><dd>{identity.subject}</dd><dt>{tx("组织", "Organization")}</dt><dd>{identity.organizationId}</dd><dt>{tx("会话到期", "Session expiry")}</dt><dd>{new Date(identity.expiresAt).toLocaleString(locale)}</dd></dl>}
        <label>{tx("组织工作空间", "Organization workspace")}<select aria-label={tx("组织工作空间", "Organization workspace")} disabled={busy || uncertain || !workspaces.length} value={workspace} onChange={e => { setWorkspace(e.target.value); resetApproval(); setCode(""); }}><option value="">{tx("选择工作空间", "Select workspace")}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.displayName}</option>)}</select></label>
        {identity && !workspaces.length && <p>{tx("该账号没有可访问的工作空间。", "No accessible workspaces for this account.")}</p>}
      </>}
    </section>
    {client.enabled && <section><h3>{tx("设备接入审批", "Device access approval")}</h3><p>{tx("输入目标设备显示的一次性授权码，核对设备信息后使用系统安全验证批准接入。", "Enter the one-time code shown by the target device, review its identity, then approve with system security verification.")}</p>
      <label>{tx("设备授权码", "Device code")}<input aria-label={tx("设备授权码", "Device code")} autoComplete="off" spellCheck={false} maxLength={128} disabled={busy || uncertain || !!approval} value={code} onChange={e => { setCode(e.target.value); resetApproval(); }} /></label>
      {!approval && <button disabled={busy || !workspace || !code.trim()} onClick={() => void perform(async signal => { const value = await client.beginDeviceApproval(workspace, code, signal); if (alive.current) setApproval(value); })}>{tx("查看设备请求", "Review device request")}</button>}
      {approval && <div className="security-review"><dl><dt>{tx("设备", "Device")}</dt><dd>{approval.authorization.deviceId}</dd><dt>{tx("工作空间", "Workspace")}</dt><dd>{approval.authorization.scope.workspaceId}</dd><dt>{tx("密钥指纹", "Key fingerprint")}</dt><dd><code>{approval.authorization.csrSpkiSha256}</code></dd><dt>{tx("验证到期", "Verification expires")}</dt><dd>{new Date(approval.challengeExpiresAt).toLocaleString(locale)}</dd></dl>
        {expired && <p>{tx("挑战已过期，请重新读取请求。", "The challenge expired. Reload the request.")}</p>}
        {uncertain ? <><p>{tx("提交结果尚未确认。请核对原审批结果，勿重复发起授权。", "The submission result is unconfirmed. Reconcile the original approval before starting another.")}</p><button disabled={busy} onClick={() => void perform(signal => complete(signal, true))}>{tx("核对原审批结果", "Reconcile approval")}</button></> : <div className="security-actions"><button disabled={busy || expired} onClick={() => void perform(signal => complete(signal))}>{tx("安全验证并批准", "Verify & approve")}</button><button disabled={busy} onClick={() => void perform(async signal => { await client.denyDeviceAuthorization(workspace, code, signal); if (alive.current) { resetApproval(); setCode(""); setResult(tx("已拒绝该设备请求。", "Device request denied.")); } })}>{tx("拒绝此设备", "Deny device")}</button><button disabled={busy} onClick={resetApproval}>{tx("取消", "Cancel")}</button></div>}
      </div>}
      <p className="security-note">{tx("需要已注册的安全密钥或通行密钥。当前服务尚未开放密钥注册入口。", "An enrolled security key or passkey is required. Credential enrollment is not yet exposed by this service.")}</p>
    </section>}
    {error && <p role="alert">{error}</p>}{result && <p role="status">{result}</p>}
  </section>;
}
