import type { NavigatorTransport } from "./transport";
import type { JsonRecord, DatasetPreview, CreateDatasetInput } from "./types";
import { NAVIGATOR_PROXY_PATHS } from "./constants";
import { parseResourceArray, parseResource } from "./parsers/validation";
import { parseDatasetPreview } from "./parsers/datasets";
import { jsonRequest } from "./requests";

export class DatasetsApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /**
   * List Catalyst-owned dataset containers through the Navigator proxy.
   * 中文：通过 Navigator 代理列出 Catalyst 管理的数据集容器。
   */
  async getDatasets(): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * List Preparations of one Catalyst dataset in insertion order.
   * 中文：按插入顺序列出一个 Catalyst 数据集的 Preparations。
   */
  async getPreparations(datasetId: string): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/preparations`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Upload a source file as a new Preparation.
   *
   * Catalyst reads the raw request body (not multipart) and takes the display
   * name and original filename from the query string.
      * 中文：将源文件上传为新的 Preparation。
   *
   * 中文：Catalyst 读取原始请求正文（不是 multipart），并从 query string 获取显示名称和原始文件名。
   */
  async createPreparation(
    datasetId: string,
    name: string,
    filename: string,
    body: string,
    contentType: string,
  ): Promise<JsonRecord> {
    const query = new URLSearchParams({ name, filename });
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/preparations?${query}`,
      {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      },
      parseResource,
    );
  }

  /**
   * Declare how imported fields map onto the SFT training shape.
   * 中文：声明导入字段如何映射到 SFT 训练数据结构。
   */
  async configurePreparationMapping(
    preparationId: string,
    command: Record<string, unknown>,
  ): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/mapping`,
      jsonRequest("PATCH", command, true),
      parseResource,
    );
  }

  /**
   * Run preparation (validate + deduplicate) on a mapped Preparation.
   * 中文：对已映射的 Preparation 执行预处理（校验并去重）。
   */
  async confirmPreparation(preparationId: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/confirm`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Publish a confirmed Preparation into an immutable DatasetVersion.
   * 中文：将已确认的 Preparation 发布为不可变 DatasetVersion。
   */
  async publishPreparation(preparationId: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/publish`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * Hand the published version to Yield as a training draft.
   * 中文：将已发布的数据集版本交给 Yield，作为训练草稿使用。
   */
  async sendPreparationToYield(preparationId: string): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/preparations/${encodeURIComponent(preparationId)}/yield-draft`,
      jsonRequest("POST", {}, true),
      parseResource,
    );
  }

  /**
   * List the DatasetVersions of one Catalyst dataset, newest first.
   *
   * Lets the console offer a picker instead of making the user paste a UUID.
      * 中文：按从新到旧的顺序列出一个 Catalyst 数据集的 DatasetVersions。
   *
   * 这样控制台可以提供选择器，而不必让用户手动粘贴 UUID。
   */
  async getDatasetVersions(datasetId: string): Promise<JsonRecord[]> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets/${encodeURIComponent(datasetId)}/versions`,
      { method: "GET" },
      parseResourceArray,
    );
  }

  /**
   * Create a dataset container; file preparation remains Catalyst-owned.
   * 中文：创建数据集容器；文件预处理仍由 Catalyst 管理。
   */
  async createDataset(input: CreateDatasetInput): Promise<JsonRecord> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/datasets`,
      jsonRequest("POST", input, true),
      parseResource,
    );
  }

  /**
   * Read dataset version sample preview through Catalyst proxy.
   * 中文：通过 Catalyst 代理读取数据集版本的样本预览。
   */
  async getDatasetVersionPreview(
    versionId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<DatasetPreview> {
    return this.transport.requestJson(
      `${NAVIGATOR_PROXY_PATHS.catalyst}/dataset-versions/${encodeURIComponent(versionId)}/preview?limit=${limit}&offset=${offset}`,
      { method: "GET" },
      parseDatasetPreview,
    );
  }
}
