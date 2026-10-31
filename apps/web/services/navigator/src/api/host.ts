import type { NavigatorTransport } from "./transport";
import type { SystemStatus, CredentialMetadata } from "./types";
import { NavigatorContractError } from "./errors";
import { parseSystemStatus, parseCredentialArray, parseCredential } from "./parsers/session";
import { jsonRequest, isPublishedProductPath } from "./requests";

export class HostApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * Read non-secret Web Host readiness and credential lifecycle counts.
   * 中文：读取不含密钥的 Web Host 就绪状态和凭据生命周期计数。
   */
  async getSystemStatus(): Promise<SystemStatus> {
    return this.transport.requestJson(
      "/api/v1/system/status",
      { method: "GET" },
      parseSystemStatus,
    );
  }

  /**
   * Read write-only credential metadata.
   * 中文：读取只写凭据元数据。
   */
  async getCredentials(): Promise<CredentialMetadata[]> {
    return this.transport.requestJson(
      "/api/v1/credentials",
      { method: "GET" },
      parseCredentialArray,
    );
  }

  /**
   * Create a credential without ever echoing its secret in the UI response.
   * 中文：创建凭据，且绝不在 UI 响应中回传密钥。
   */
  async createCredential(input: {
    name: string;
    provider: string;
    kind: string;
    secret: string;
  }): Promise<CredentialMetadata> {
    return this.transport.requestJson(
      "/api/v1/credentials",
      jsonRequest("POST", input, true),
      parseCredential,
    );
  }

  /**
   * Revoke one Web Host credential by metadata identifier.
   * 中文：按元数据标识撤销一个 Web Host 凭据。
   */
  async revokeCredential(id: string): Promise<CredentialMetadata> {
    return this.transport.requestJson(
      `/api/v1/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      parseCredential,
    );
  }

  /**
   * Send a raw response request to a published Product route through the
   * same-origin Navigator proxy. Exchange owner-token failures do not refresh
   * or expire the separate paired Web Host session.
   * 中文：通过 Navigator 同源代理请求已发布的 Product 原始响应；Exchange 所有者令牌失败不会刷新或使独立的 Web Host 配对会话失效。
   */
  async requestProductResponse(path: string, init: RequestInit = {}): Promise<Response> {
    if (!isPublishedProductPath(path)) {
      throw new NavigatorContractError("Product requests must use a published same-origin path.");
    }
    const pathname = path.split("?", 1)[0] ?? path;
    const exchangePath = pathname === "/api/v1/integrations" || pathname.startsWith("/api/v1/integrations/")
      || /^\/api\/v1\/accounts\/(?:authorizations\/[^/]+\/renewal-sessions|renewal-sessions\/[^/]+)$/.test(pathname);
    const explicitExchangeBearer = exchangePath && new Headers(init.headers).has("X-Cyrene-Product-Authorization");
    return this.transport.requestResponse(path, init, !explicitExchangeBearer, !explicitExchangeBearer);
  }
}
