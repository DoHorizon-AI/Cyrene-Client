import type { NavigatorTransport } from "./transport";
import type { JsonRecord, CreateModelImportInput } from "./types";
import { NAVIGATOR_PROXY_PATHS } from "./constants";
import { parseResourceArray, parseResource } from "./parsers/validation";
import { jsonRequest } from "./requests";

export class ModelsApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * List Reactor-owned model imports through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Reactor 管理的模型导入项。
   */
  async getModelImports(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/model-imports`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * List serving bindings available to the current Reactor installation.
   * 中文：列出当前 Reactor 安装可用的 serving binding。
   */
  async getServingBindings(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/serving-bindings`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Start a model import with a stable mutation key.
   * 中文：使用稳定的 mutation key 启动模型导入。
   */
  async createModelImport(input: CreateModelImportInput): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.reactor}/model-imports`,
      jsonRequest("POST", input, true),
      parseResource,
    );
  }
}
