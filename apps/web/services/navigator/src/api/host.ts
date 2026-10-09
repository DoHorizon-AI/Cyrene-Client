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
   * Send a raw response request to the published Catalyst or Echo API through
   * the same-origin Navigator proxy. Use this for new Product contract routes
   * and binary downloads while keeping session refresh and CSRF in one place.
   * 中文：通过 Navigator 同源代理请求 Catalyst 或 Echo API 原始响应；新 Product 路由和二进制下载仍复用会话轮换与 CSRF 处理。
   */
  async requestProductResponse(path: string, init: RequestInit = {}): Promise<Response> {
    if (!isPublishedProductPath(path)) {
      throw new NavigatorContractError("Product requests must use a published Catalyst or Echo same-origin path.");
    }
    return this.transport.requestResponse(path, init);
  }
}
