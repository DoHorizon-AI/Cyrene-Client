import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavigatorApi, type SessionPayload } from "../../services/navigator/src/api";
import { studioProductFetch } from "../products/transport";
import { useTeamIdentity } from "../team/TeamGate";
import { SettingsClient } from "./client";
import { WorkspaceBffClient } from "./workspace-bff-client";

interface SharedSession {
  api: NavigatorApi; settings: SettingsClient; workspaceBff: WorkspaceBffClient;
  session: SessionPayload | null; error: string;
  reconnect(): Promise<void>; pair(code: string): Promise<void>; disconnect(): Promise<void>;
}
const SessionContext = createContext<SharedSession | null>(null);

/** One browser owns one refresh coordinator and one in-memory CSRF token. */
export function NavigatorSessionProvider({ children }: { children: ReactNode }) {
  const { actorId, workspaceId } = useTeamIdentity();
  return <SessionOwner key={`${actorId}:${workspaceId}`}>{children}</SessionOwner>;
}

function SessionOwner({ children }: { children: ReactNode }) {
  const [clients] = useState(() => {
    const api = new NavigatorApi(studioProductFetch), workspaceBff = new WorkspaceBffClient();
    return { api, workspaceBff, settings: new SettingsClient(studioProductFetch, 10_000, workspaceBff, api) };
  });
  const [session, setSession] = useState<SessionPayload | null>(null), [error, setError] = useState("");
  const wasAuthenticated = useRef(false);
  const reconnect = useCallback(async () => { await clients.api.restoreSession(); setError(""); }, [clients]);
  useEffect(() => {
    let active = true;
    const unsubscribe = clients.api.subscribeSession(value => {
      if (!active) return;
      if (wasAuthenticated.current && !value.authenticated) clients.settings.onExpired?.();
      wasAuthenticated.current = value.authenticated; setSession(value); setError("");
    });
    void reconnect().catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; unsubscribe(); clients.workspaceBff.reset(); };
  }, [clients, reconnect]);
  useEffect(() => {
    if (!session?.authenticated || !session.expiresAt) return;
    let active = true;
    const timer = setTimeout(() => {
      void clients.api.refreshSession().catch(reason => { if (active) setError(String(reason)); });
    }, Math.min(2_147_483_647, Math.max(1000, Date.parse(session.expiresAt) - Date.now() - 30_000)));
    return () => { active = false; clearTimeout(timer); };
  }, [clients, session]);
  return <SessionContext.Provider value={{ ...clients, session, error, reconnect,
    pair: async code => { await clients.api.pair(code); }, disconnect: async () => { await clients.api.logout(); },
  }}>{children}</SessionContext.Provider>;
}

export function useNavigatorSession(): SharedSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error("NavigatorSessionProvider is required.");
  return value;
}
