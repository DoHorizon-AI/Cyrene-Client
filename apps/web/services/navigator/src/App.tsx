// -----------------------------------------------------------------------------
// Module: src/App.tsx
// Role: Session gate, shell navigation, Context Switcher, and page composition for Cyrene.
// -----------------------------------------------------------------------------
// 中文：模块职责：管理会话入口、顶栏品牌与上下文切换器 (Context Switcher)、
//       外壳侧边栏导航，并组合 Cyrene 统一客户端各页面与服务。

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Button, formatDate, StateBlock } from "./components";
import { NavigatorApi, NavigatorHttpError, type SessionPayload } from "./api";
import { SettingsPage } from "./pages";
import {
  CatalystWorkspace,
  YieldWorkspace,
  EchoWorkspace,
  ReactorWorkspace,
  ExchangeWorkspace,
  NavigatorWorkspace,
} from "./workspaces";
import { FlowPage } from "./canvas/FlowPage";
import { IntegrationsPage } from "./integrations/IntegrationsPage";
import { pushRoute, routeForPath, ROUTES, type RouteId } from "./router";

/**
 * Own the browser session gate and mount only authenticated Product surfaces.
 * 拥有浏览器会话入口，并且只挂载已经认证的 Product 页面。
 */
export function App() {
  const [api] = useState(() => new NavigatorApi());
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    api.setSessionExpiredHandler(() => {
      setSession(anonymousSession());
    });
    return () => api.setSessionExpiredHandler(null);
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.restoreSession().then(
      (value) => {
        if (active) {
          setSession(value);
          setBootError(null);
        }
      },
      (reason: unknown) => {
        if (active) {
          setBootError(errorMessage(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!session?.authenticated || !session.expiresAt) {
      return;
    }
    const expiresAt = new Date(session.expiresAt).getTime();
    const delay = Math.max(1_000, expiresAt - Date.now() - 30_000);
    const timer = window.setTimeout(() => {
      void api.refreshSession().then(
        (value) => setSession(value),
        (reason: unknown) => {
          if (reason instanceof NavigatorHttpError && reason.status === 401) {
            setSession(anonymousSession());
          }
        },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [api, session]);

  if (bootError) {
    return (
      <AppFrame>
        <div className="center-state">
          <StateBlock
            kind="error"
            title="Cyrene Web Host is unreachable"
            detail={bootError}
            action={<Button onClick={() => window.location.reload()}>Retry session check</Button>}
          />
        </div>
      </AppFrame>
    );
  }

  if (!session) {
    return (
      <AppFrame>
        <div className="center-state">
          <StateBlock kind="loading" title="Opening Cyrene" detail="Checking the same-origin Web Host session." />
        </div>
      </AppFrame>
    );
  }

  if (!session.authenticated) {
    return <LoginView api={api} onAuthenticated={setSession} />;
  }

  return (
    <AppShell
      api={api}
      session={session}
      onSessionChange={setSession}
    />
  );
}

interface LoginViewProps {
  api: NavigatorApi;
  onAuthenticated: (session: SessionPayload) => void;
}

/**
 * Pair with the launcher-delivered one-time code without persisting it.
 * 使用启动器交付的一次性代码完成配对，且不持久化保存该代码。
 */
function LoginView({ api, onAuthenticated }: LoginViewProps) {
  const [pairingCode, setPairingCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await api.pair(pairingCode));
    } catch (pairError) {
      setError(errorMessage(pairError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppFrame>
      <main className="login-layout">
        <section className="login-card">
          <div className="brand-mark brand-mark--large" aria-hidden="true">C</div>
          <p className="eyebrow">cyrene / client</p>
          <h1>Enter the field.</h1>
          <p className="login-copy">Pair this browser with the local Cyrene host. The code is printed once by the host launcher and is never stored by the UI.</p>
          <form onSubmit={submit}>
            <label className="field">
              <span className="field__label">One-time pairing code</span>
              <input
                autoFocus
                className="input-mono input-large"
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
                autoComplete="one-time-code"
                placeholder="Paste the launcher code"
              />
            </label>
            <Button tone="primary" type="submit" disabled={submitting || !pairingCode.trim()}>
              {submitting ? "Pairing..." : "Open console"}
            </Button>
            {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
          </form>
          <p className="login-footnote">Same-origin session | rotating refresh | CSRF protected mutations</p>
        </section>
        <aside className="login-aside" aria-label="Cyrene boundary notes">
          <span className="eyebrow">What stays true</span>
          <strong>Every page reads the owner.</strong>
          <p>Cyrene presents unified Product projections. It does not copy lifecycle state into browser storage or choose arbitrary upstream origins.</p>
          <div className="login-aside__line" />
          <span className="mono-label">SESSION / PRODUCT / PROXY</span>
        </aside>
      </main>
    </AppFrame>
  );
}

interface AppShellProps {
  api: NavigatorApi;
  session: SessionPayload;
  onSessionChange: (session: SessionPayload) => void;
}

/**
 * Desktop rail, dynamic brand header with Context Switcher, and responsive container.
 * 桌面侧栏、带上下文切换器的动态品牌顶栏及响应式容器。
 */
function AppShell({ api, session, onSessionChange }: AppShellProps) {
  const [route, setRoute] = useState<RouteId>(() => routeForPath(window.location.pathname));
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePopState = () => setRoute(routeForPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setIsSwitcherOpen(false);
      }
    };
    if (isSwitcherOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSwitcherOpen]);

  const navigate = (nextRoute: RouteId) => {
    if (nextRoute !== route) {
      pushRoute(nextRoute);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onSessionChange(anonymousSession());
    }
  };

  const currentRoute = ROUTES.find((definition) => definition.id === route) ?? ROUTES[0];

  // 顶栏动态标题：当 route === 'flow' 时，只显示 "cyrene"；其他服务显示 "cyrene [service]"
  const displayTitle = route === "flow" ? "cyrene" : `cyrene ${route}`;

  return (
    <div className="console-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">C</div>
          <div>
            <strong>cyrene</strong>
            <span>client platform</span>
          </div>
        </div>
        <div className="rail-rule" />
        <nav className="main-nav" aria-label="Primary navigation">
          {ROUTES.map((definition) => (
            <button
              className={`nav-item ${definition.id === route ? "nav-item--active" : ""}`.trim()}
              key={definition.id}
              onClick={() => navigate(definition.id)}
              aria-current={definition.id === route ? "page" : undefined}
            >
              <span className="nav-item__glyph" aria-hidden="true">{navGlyph(definition.id)}</span>
              <span>
                <strong>{definition.label}</strong>
                <small>{definition.description}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <span className="status-led" aria-hidden="true" />
          <span>Web Host session active</span>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar__context" ref={switcherRef}>
            <div className="topbar__title-wrapper">
              <span className="topbar__brand-title">{displayTitle}</span>
              <button
                type="button"
                className={`context-switcher__button ${isSwitcherOpen ? "context-switcher__button--active" : ""}`}
                onClick={() => setIsSwitcherOpen((prev) => !prev)}
                aria-expanded={isSwitcherOpen}
                aria-label="打开上下文与服务切换器 (Context Switcher)"
                title="点击切换 Cyrene 服务与画布上下文"
              >
                <span className="context-switcher__current-label">{currentRoute.label}</span>
                <svg
                  className={`context-switcher__chevron ${isSwitcherOpen ? "context-switcher__chevron--rotated" : ""}`}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            {/* Context Switcher 下拉菜单 */}
            {isSwitcherOpen && (
              <div className="context-switcher__menu" role="menu">
                <div className="context-switcher__menu-header">
                  <span className="mono-label">CONTEXT SWITCHER · 上下文切换</span>
                  <p>在 Cyrene 全局流程画布与专职子服务间一键无缝跳转</p>
                </div>

                <div className="context-switcher__section">
                  <span className="context-switcher__section-title">全局编排</span>
                  <button
                    type="button"
                    role="menuitem"
                    className={`context-switcher__item ${route === "flow" ? "context-switcher__item--active" : ""}`}
                    onClick={() => {
                      navigate("flow");
                      setIsSwitcherOpen(false);
                    }}
                  >
                    <span className="context-switcher__item-icon">💠</span>
                    <div className="context-switcher__item-text">
                      <div className="context-switcher__item-top">
                        <strong>cyrene</strong>
                        <span className="context-switcher__pill">主页 / 画布</span>
                      </div>
                      <small>全局流程画布与跨服务流式节点编排</small>
                    </div>
                    {route === "flow" && <span className="status-led" aria-hidden="true" />}
                  </button>
                </div>

                <div className="context-switcher__section">
                  <span className="context-switcher__section-title">核心业务子服务</span>
                  <div className="context-switcher__grid">
                    {ROUTES.filter((r) => !["flow", "integrations", "settings"].includes(r.id)).map((def) => {
                      const isActive = route === def.id;
                      return (
                        <button
                          type="button"
                          key={def.id}
                          role="menuitem"
                          className={`context-switcher__item ${isActive ? "context-switcher__item--active" : ""}`}
                          onClick={() => {
                            navigate(def.id);
                            setIsSwitcherOpen(false);
                          }}
                        >
                          <span className="context-switcher__item-icon">{serviceEmoji(def.id)}</span>
                          <div className="context-switcher__item-text">
                            <div className="context-switcher__item-top">
                              <strong>cyrene {def.id}</strong>
                              <span className="context-switcher__tag">{def.label.split(" ")[1] ?? def.label}</span>
                            </div>
                            <small>{def.description}</small>
                          </div>
                          {isActive && <span className="status-led" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="context-switcher__section">
                  <span className="context-switcher__section-title">向导与系统配置</span>
                  <div className="context-switcher__grid">
                    {ROUTES.filter((r) => ["integrations", "settings"].includes(r.id)).map((def) => {
                      const isActive = route === def.id;
                      return (
                        <button
                          type="button"
                          key={def.id}
                          role="menuitem"
                          className={`context-switcher__item ${isActive ? "context-switcher__item--active" : ""}`}
                          onClick={() => {
                            navigate(def.id);
                            setIsSwitcherOpen(false);
                          }}
                        >
                          <span className="context-switcher__item-icon">{serviceEmoji(def.id)}</span>
                          <div className="context-switcher__item-text">
                            <div className="context-switcher__item-top">
                              <strong>cyrene {def.id}</strong>
                              <span className="context-switcher__tag">{def.label}</span>
                            </div>
                            <small>{def.description}</small>
                          </div>
                          {isActive && <span className="status-led" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <span className="topbar__mode">
              <span className="status-led" aria-hidden="true" /> SAME-ORIGIN
            </span>
          </div>

          <div className="topbar__session">
            <span className="topbar__expiry">Refresh window | {formatDate(session.refreshExpiresAt)}</span>
            <Button onClick={() => void logout()}>Sign out</Button>
          </div>
        </header>

        <div className="mobile-nav" aria-label="Mobile navigation">
          {ROUTES.map((definition) => (
            <button
              className={definition.id === route ? "mobile-nav__item mobile-nav__item--active" : "mobile-nav__item"}
              key={definition.id}
              onClick={() => navigate(definition.id)}
            >
              <span className="mobile-nav__glyph">{navGlyph(definition.id)}</span>
              <span>{definition.label}</span>
            </button>
          ))}
        </div>

        <div className="page-container">{renderPage(route, api, session)}</div>
      </main>
    </div>
  );
}

function renderPage(route: RouteId, api: NavigatorApi, session: SessionPayload): ReactNode {
  switch (route) {
    case "flow":
      return <FlowPage />;
    case "catalyst":
      return <CatalystWorkspace api={api} />;
    case "yield":
      return <YieldWorkspace api={api} />;
    case "echo":
      return <EchoWorkspace api={api} />;
    case "reactor":
      return <ReactorWorkspace api={api} />;
    case "exchange":
      return <ExchangeWorkspace api={api} />;
    case "navigator":
      return <NavigatorWorkspace api={api} />;
    case "integrations":
      return <IntegrationsPage />;
    case "settings":
      return <SettingsPage api={api} session={session} />;
    default:
      return <FlowPage />;
  }
}

function navGlyph(route: RouteId): string {
  const glyphs: Record<string, string> = {
    flow: "FL",
    catalyst: "CT",
    yield: "YD",
    echo: "EC",
    reactor: "RT",
    exchange: "EX",
    navigator: "NV",
    integrations: "IN",
    settings: "ST",
  };
  return glyphs[route] ?? "FL";
}

function serviceEmoji(route: RouteId): string {
  switch (route) {
    case "flow":
      return "💠";
    case "catalyst":
      return "🧬";
    case "yield":
      return "⚡";
    case "echo":
      return "🧪";
    case "reactor":
      return "🚀";
    case "exchange":
      return "🌐";
    case "navigator":
      return "💬";
    case "integrations":
      return "🔌";
    case "settings":
      return "⚙️";
    default:
      return "💠";
  }
}

function anonymousSession(): SessionPayload {
  return {
    authenticated: false,
    state: "ANONYMOUS",
    sessionId: null,
    expiresAt: null,
    refreshExpiresAt: null,
    refreshable: false,
    csrfToken: null,
    refreshed: false,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof NavigatorHttpError) {
    return `${error.detail} (${error.code})`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "The Cyrene Web Host did not return a readable error.";
}

function AppFrame({ children }: { children: ReactNode }) {
  return <div className="app-root">{children}</div>;
}
