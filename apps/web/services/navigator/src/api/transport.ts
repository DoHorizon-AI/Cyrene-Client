import type { SessionPayload, ResponseParser, Fetcher } from "./types";
import { NavigatorHttpError, NavigatorContractError } from "./errors";
import { AUTH_SESSION_PATH, AUTH_REFRESH_PATH, AUTH_PAIR_PATH, AUTH_LOGOUT_PATH } from "./constants";
import { parseSession } from "./parsers/session";
import { jsonRequest, readResponse, readCookie } from "./requests";

interface CookieAuthority {
  csrfToken: string | null;
  session: SessionPayload | null;
  generation: number;
  mutationTail: Promise<void>;
  pendingMutations: number;
  refreshInFlight: Promise<SessionPayload> | null;
  listeners: Set<(session: SessionPayload) => void>;
}
// Provider identity changes rebuild the UI, while browser cookies remain shared.
// Custom fetchers identify independent transports (including isolated fixtures).
const defaultFetcher: Fetcher = (input, init) => globalThis.fetch(input, init);
const authorities = new WeakMap<Fetcher, CookieAuthority>();
function cookieAuthority(fetcher: Fetcher): CookieAuthority {
  let authority = authorities.get(fetcher);
  if (!authority) {
    authority = { csrfToken: null, session: null, generation: 0, mutationTail: Promise.resolve(),
      pendingMutations: 0, refreshInFlight: null, listeners: new Set() };
    authorities.set(fetcher, authority);
  }
  return authority;
}

/** Owns the shared browser session and authenticated same-origin transport. */
export class NavigatorTransport {
  private readonly authority: CookieAuthority;
  constructor(private readonly fetcher: Fetcher = defaultFetcher) { this.authority = cookieAuthority(fetcher); }

  private get csrfToken() { return this.authority.csrfToken; }
  private set csrfToken(value: string | null) { this.authority.csrfToken = value; }
  private get refreshInFlight() { return this.authority.refreshInFlight; }
  private set refreshInFlight(value: Promise<SessionPayload> | null) { this.authority.refreshInFlight = value; }
  private sessionExpiredHandler: (() => void) | null = null;
  private get session() { return this.authority.session; }
  private set session(value: SessionPayload | null) { this.authority.session = value; }
  private get sessionListeners() { return this.authority.listeners; }
  private restoreInFlight: Promise<SessionPayload> | null = null;
  private get sessionGeneration() { return this.authority.generation; }
  private set sessionGeneration(value: number) { this.authority.generation = value; }
  private get authMutationTail() { return this.authority.mutationTail; }
  private set authMutationTail(value: Promise<void>) { this.authority.mutationTail = value; }
  private get pendingAuthMutations() { return this.authority.pendingMutations; }
  private set pendingAuthMutations(value: number) { this.authority.pendingMutations = value; }

  get sessionCsrfToken(): string | null { return this.csrfToken; }
  subscribeSession(listener: (session: SessionPayload) => void): () => void {
    this.sessionListeners.add(listener);
    if (this.session) listener(this.session);
    return () => { this.sessionListeners.delete(listener); };
  }

  /**
   * Register the App-level response for an exhausted Web Host session.
   * 中文：为会话耗尽的 Web Host 响应注册 App 级处理函数。
   */
  setSessionExpiredHandler(handler: (() => void) | null): void {
    this.sessionExpiredHandler = handler;
  }

  /**
   * Read current session state and rotate it when only refresh state remains.
   * 中文：读取当前会话状态；如果只剩刷新凭据，则轮换会话。
   */
  async restoreSession(): Promise<SessionPayload> {
    if (this.restoreInFlight) return this.restoreInFlight;
    this.restoreInFlight = this.restoreCurrentSession();
    try { return await this.restoreInFlight; }
    finally { this.restoreInFlight = null; }
  }
  private async restoreCurrentSession(): Promise<SessionPayload> {
    const session = await this.getSession();
    if (!session.authenticated && session.refreshable) {
      try {
        return await this.refreshSession();
      } catch (error) {
        if (error instanceof NavigatorHttpError && error.status === 401) {
          return session;
        }
        throw error;
      }
    }
    return session;
  }

  /**
   * Pair the browser with the one-time code printed by the Web Host launcher.
   * 中文：使用 Web Host 启动器打印的一次性代码关联当前浏览器会话。
   */
  async pair(pairingCode: string): Promise<SessionPayload> {
    const value = pairingCode.trim();
    if (!value) {
      throw new NavigatorContractError("Enter the one-time Navigator pairing code.");
    }
    return this.mutateSession(async () => {
      const session = await this.requestJson(AUTH_PAIR_PATH, jsonRequest("POST", { pairingCode: value }), parseSession, false, false);
      this.acceptSession(session);
      return session;
    });
  }

  /**
   * Return session state without converting anonymous access into an error.
   * 中文：读取会话状态，不会将匿名访问转换为错误。
   */
  async getSession(): Promise<SessionPayload> {
    if (this.pendingAuthMutations) await this.waitForSessionMutations();
    await this.waitForSessionMutations();
    const generation = this.sessionGeneration;
    const result = await this.requestJson(AUTH_SESSION_PATH, { method: "GET" }, parseSession, false);
    if (generation !== this.sessionGeneration || this.pendingAuthMutations) {
      await this.waitForSessionMutations();
      return this.session ?? result;
    }
    return result;
  }

  /**
   * Rotate the refresh cookie and its CSRF token, coalescing concurrent calls.
   * 中文：轮换刷新 cookie 和 CSRF token，并合并并发调用。
   */
  async refreshSession(): Promise<SessionPayload> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.mutateSession(async () => {
      try {
        const session = await this.requestJson(AUTH_REFRESH_PATH, { method: "POST" }, parseSession, false, false);
        this.acceptSession(session);
        return session;
      } catch (reason) {
        if (reason instanceof NavigatorHttpError && reason.status === 401) {
          this.sessionExpiredHandler?.(); this.expireSession();
        }
        throw reason;
      }
    });
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  /**
   * Revoke the browser session and clear the in-memory CSRF token.
   * 中文：撤销浏览器会话并清除内存中的 CSRF token。
   */
  async logout(): Promise<void> {
    return this.mutateSession(async () => {
      await this.requestJson<void>(AUTH_LOGOUT_PATH, { method: "DELETE" }, () => undefined, false);
      this.expireSession();
    });
  }

  /** Cookie-changing requests must complete in intent order, including Set-Cookie. */
  private mutateSession<T>(operation: () => Promise<T>): Promise<T> {
    this.sessionGeneration++;
    this.pendingAuthMutations++;
    const result = this.authMutationTail.then(() => {
      this.sessionGeneration++;
      return operation();
    }).finally(() => { this.sessionGeneration++; this.pendingAuthMutations--; });
    this.authMutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async waitForSessionMutations(): Promise<void> {
    while (this.pendingAuthMutations) await this.authMutationTail;
  }

  async requestJson<T>(
    path: string,
    init: RequestInit,
    parser: ResponseParser<T>,
    retryAuth = true,
    acceptSessionResponse = true,
  ): Promise<T> {
    const generation = this.sessionGeneration;
    const response = await this.requestResponse(path, init, retryAuth);
    return readResponse(response, path, parser, payload => { if (acceptSessionResponse && generation === this.sessionGeneration) this.acceptSession(payload); });
  }

  async requestResponse(path: string, init: RequestInit, retryAuth = true): Promise<Response> {
    init.signal?.throwIfAborted();
    let generation = this.sessionGeneration;
    const response = await this.send(path, init);
    if (response.status !== 401 || path.startsWith("/api/v1/auth/")) return response;
    const mayRetryRead = /^(GET|HEAD)$/.test((init.method ?? "GET").toUpperCase());
    if (generation !== this.sessionGeneration || this.pendingAuthMutations) {
      await this.waitForSessionMutations();
      init.signal?.throwIfAborted();
      if (retryAuth && mayRetryRead && this.session?.authenticated) {
        await response.body?.cancel();
        return this.requestResponse(path, init, false);
      }
      // An old denial cannot refresh or expire a newer browser session.
      return response;
    }
    let sessionExhausted = true;
    if (retryAuth) {
      let authenticated = false;
      try {
        const refreshed = await this.refreshSession();
        await this.waitForSessionMutations();
        const sameSession = this.session === refreshed;
        authenticated = this.session?.authenticated === true && (sameSession || mayRetryRead);
        if (sameSession) generation = this.sessionGeneration;
      } catch (reason) {
        sessionExhausted = reason instanceof NavigatorHttpError && reason.status === 401;
        // The original response contains the useful Product/Web Host problem.
        // 中文：原始响应包含有用的 Product/Web Host 错误信息。
      }
      init.signal?.throwIfAborted();
      if (authenticated) {
        await response.body?.cancel();
        return this.requestResponse(path, init, false);
      }
    }
    if (sessionExhausted && generation === this.sessionGeneration && !this.pendingAuthMutations) {
      this.sessionExpiredHandler?.();
      this.csrfToken = null;
      this.expireSession();
    }
    return response;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const method = (init.method || "GET").toUpperCase();
    const isMutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    if (isMutation && this.csrfToken && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", this.csrfToken);
    }
    if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return this.fetcher(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  }

  private acceptSession(payload: SessionPayload): void {
    if (payload.csrfToken) {
      this.csrfToken = payload.csrfToken;
    } else if (!payload.refreshable) {
      this.csrfToken = null;
    } else if (!this.csrfToken) {
      this.csrfToken = readCookie("cyrene_csrf");
    }
    this.session = payload;
    for (const listener of this.sessionListeners) listener(payload);
  }
  private expireSession(): void {
    this.sessionGeneration++;
    this.acceptSession({ sessionId: null, expiresAt: null, refreshExpiresAt: null, refreshed: false,
      ...this.session, authenticated: false, state: "ANONYMOUS", csrfToken: null, refreshable: false });
  }
}
