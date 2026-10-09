import type { NavigatorTransport } from "./transport";
import type { JsonRecord, ActiveRoutePayload, ApiKeyMetadata, CreateApiKeyInput } from "./types";
import { NAVIGATOR_PROXY_PATHS } from "./constants";
import { parseResourceArray, parseResource } from "./parsers/validation";
import { parseActiveRoute, parseApiKey, parseApiKeyArray, parseCreatedApiKey } from "./parsers/exchange";
import { jsonRequest } from "./requests";

export class ExchangeApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * Read Gateway routes configured on Exchange.
   * 中文：读取 Exchange 配置的网关路由。
   */
  async getGatewayRoutes(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-routes`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Read Gateway endpoints configured on Exchange.
   * 中文：读取 Exchange 配置的网关 Endpoint。
   */
  async getGatewayEndpoints(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-endpoints`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Confirm and publish a draft gateway route.
   * 中文：确认并发布一条草稿网关路由。
   */
  async confirmGatewayRoute(routeId: string, resourceVersion: number): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/gateway-route-drafts/${encodeURIComponent(routeId)}/actions/confirm`,
      jsonRequest("POST", { resourceVersion }, true),
      parseResource,
    );
  }

  /**
   * List Exchange gateway API keys.
   * 中文：列出 Exchange 网关 API key。
   */
  async listApiKeys(): Promise<ApiKeyMetadata[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys`,
      { method: "GET" },
      parseApiKeyArray,
    );
  }

  /**
   * Create an Exchange gateway API key; secret is returned exactly once.
   * 中文：创建 Exchange 网关 API key；密钥只会返回一次。
   */
  async createApiKey(
    routeId: string,
    input: CreateApiKeyInput | JsonRecord,
  ): Promise<{ key: ApiKeyMetadata; secret: string }> {
    void routeId;
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys`,
      jsonRequest("POST", input, true),
      parseCreatedApiKey,
    );
  }

  /**
   * Revoke an Exchange gateway API key.
   * 中文：撤销一个 Exchange 网关 API key。
   */
  async revokeApiKey(id: string): Promise<ApiKeyMetadata> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.exchange}/api/v1/api-keys/${encodeURIComponent(id)}/actions/revoke`,
      jsonRequest("POST", {}, true),
      parseApiKey,
    );
  }

  /**
   * Read active gateway route from Navigator Web Host session.
   * 中文：从 Navigator Web Host 会话读取当前网关路由。
   */
  async getActiveRoute(): Promise<ActiveRoutePayload> {
    return this.transport.requestJson(
      "/api/v1/navigator/active-route",
      { method: "GET" },
      parseActiveRoute,
    );
  }

  /**
   * Store active gateway route into Navigator Web Host session.
   * 中文：将当前网关路由写入 Navigator Web Host 会话。
   */
  async setActiveRoute(payload: ActiveRoutePayload): Promise<ActiveRoutePayload> {
    return this.transport.requestJson(
      "/api/v1/navigator/active-route",
      jsonRequest("POST", payload, true),
      parseActiveRoute,
    );
  }
}
