import type { NavigatorTransport } from "./transport";
import type { JsonRecord, DeploymentEventsResponse } from "./types";
import { NAVIGATOR_PROXY_PATHS } from "./constants";
import { parseResourceArray, parseResource } from "./parsers/validation";
import { parseDeploymentEventsResponse } from "./parsers/deployment";
import { jsonRequest } from "./requests";

export class DeploymentApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * List Reactor deployment intent and observed lifecycle projections.
   * 中文：列出 Reactor 的部署意图和观测到的生命周期投影。
   */
  async getDeployments(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Stop one deployment through Reactor's explicit lifecycle action.
   * 中文：通过 Reactor 的显式生命周期操作停止一项部署。
   */
  async stopDeployment(id: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments/${encodeURIComponent(id)}/actions/stop`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Read deployment loading phase events through Reactor proxy.
   * 中文：通过 Reactor 代理读取部署加载阶段事件。
   */
  async getDeploymentEvents(deploymentId: string): Promise<DeploymentEventsResponse> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/deployments/${encodeURIComponent(deploymentId)}/events`,
      { method: "GET" },
      parseDeploymentEventsResponse,
    );
  }
}
