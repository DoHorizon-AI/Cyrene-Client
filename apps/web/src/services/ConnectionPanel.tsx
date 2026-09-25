import { useEffect, useRef, useState } from "react";
import type { HostStatus } from "../../../../packages/service-settings/contracts";
import { SettingsClient } from "./client";

interface Props { client: SettingsClient; status: HostStatus | null; onConnected(status: HostStatus | null): void }
export function ConnectionPanel({ client, status, onConnected }: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string | null>(null), [pairing, setPairing] = useState(false);
  const [code, setCode] = useState(""), [message, setMessage] = useState("先连接 Web Host，再从节点面板读取服务设置。");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    client.onExpired = () => { onConnected(null); setPairing(true); setMessage("会话已失效，请重新配对。"); };
    return () => { alive.current = false; client.onExpired = undefined; };
  }, [client, onConnected]);
  async function connect(pair = false) {
    if (busy) return;
    setBusy(true);
    try {
      const connection = await client.connection();
      if (!alive.current) return;
      setTarget(connection.target);
      if (!connection.configured) throw new Error("尚未配置 Web Host。请按 README 在 Client 的 .env.local 设置 STUDIO_NAVIGATOR_URL 并重启开发服务。");
      const session = pair ? await client.pair(code) : await client.session();
      if (!alive.current) return;
      setPairing(!session.authenticated);
      if (!session.authenticated) { onConnected(null); setMessage("Web Host 可访问，请输入其启动时提供的一次性配对码。"); return; }
      const next = await client.status();
      if (!alive.current) return;
      if (!next.authenticated) throw new Error("Web Host 未确认当前会话，请重新连接。");
      onConnected(next); setCode(""); setMessage("已连接。各节点将独立检查所属服务；连接 Web Host 不表示所有服务可用。");
    } catch (e) { if (alive.current) { onConnected(null); setMessage(e instanceof Error ? e.message : "连接失败。"); } }
    finally { if (alive.current) { setBusy(false); if (pair) setCode(""); } }
  }
  async function disconnect() {
    setBusy(true);
    try { await client.disconnect(); onConnected(null); setPairing(false); setMessage("已退出 Web Host 会话。本地流程草稿保留。"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "退出失败。"); }
    finally { setBusy(false); }
  }
  return <div className="connection-box">
    <button className="connection-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><i className="dot" />{status ? "设置服务已连接" : "服务连接"}</button>
    {open && <section className="connection-popover" aria-label="服务连接设置">
      <strong>Navigator Web Host</strong>
      {target && <p className="connection-target">{target}</p>}
      <p role="status">{message}</p>
      {pairing && <label className="field"><span>一次性配对码</span><input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></label>}
      <div className="settings-actions"><button disabled={busy} onClick={() => void connect(false)}>{busy ? "连接中…" : "检查连接"}</button>{pairing && <button className="primary" disabled={busy || !code.trim()} onClick={() => void connect(true)}>配对</button>}{status && <button disabled={busy} onClick={() => void disconnect()}>退出会话</button>}</div>
      {status && <small>已开放 {status.proxyPrefixes.length} 个服务入口 · {status.observedAt}</small>}
    </section>}
  </div>;
}
