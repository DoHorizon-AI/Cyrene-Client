import type { NavigatorTransport } from "./transport";
import type { WorkSchemas } from "../generated/contracts";
import type { JsonRecord, WorkApproval, WorkInput, MemoryFact, WorkNotification, WorkAttachment, WorkConnector, QqConnectorHealth, QqLoginChallenge, QqLoginState } from "./types";
import { NavigatorContractError } from "./errors";
import { parseResource } from "./parsers/validation";
import { parseApprovalList, parseWorkInputList, parseMemoryFacts, parseMemoryFact, parseNotificationList, parseAttachment, parseConnectorList, parseQqHealth, parseQqLoginChallenge, parseQqLoginState } from "./parsers/work";
import { jsonRequest, makeIdempotencyKey, workId, workPath, toHttpError } from "./requests";

export class WorkApi {
  constructor(private readonly transport: NavigatorTransport) {}

  /** Read pending approval records from the configured durable workspace. 中文：读取工作空间中的待审批记录。 */
  async getWorkApprovals(workspaceId: string): Promise<WorkApproval[]> {
    const query = new URLSearchParams({ status: "pending", limit: "100" });
    return this.transport.requestJson(workPath(workspaceId, `approvals?${query}`), { method: "GET" }, parseApprovalList);
  }

  /** Resolve an approval exactly once through its owning work service. 中文：通过所属工作服务一次性完成审批。 */
  async resolveWorkApproval(workspaceId: string, approvalId: string, decision: WorkSchemas["ApprovalResolve"]["decision"], scope: NonNullable<WorkSchemas["ApprovalResolve"]["scope"]> = "once"): Promise<JsonRecord> {
    return this.transport.requestJson(
      workPath(workspaceId, `approvals/${workId(approvalId)}/resolve`),
      jsonRequest("POST", { decision, messageId: makeIdempotencyKey(), ...(scope === "task" ? { scope } : {}) }, true),
      parseResource,
    );
  }

  /** Read pending user-input requests owned by the configured workspace. 中文：读取当前工作空间中的待补充信息请求。 */
  async getWorkInputs(workspaceId: string): Promise<WorkInput[]> {
    const query = new URLSearchParams({ status: "pending", limit: "100" });
    return this.transport.requestJson(workPath(workspaceId, `inputs?${query}`), { method: "GET" }, parseWorkInputList);
  }

  /** Answer one durable user-input request through its workspace owner. 中文：通过工作空间服务回答一项持久化的信息请求。 */
  async resolveWorkInput(workspaceId: string, inputId: string, answer: string, messageId = makeIdempotencyKey()): Promise<JsonRecord> {
    return this.transport.requestJson(
      workPath(workspaceId, `inputs/${workId(inputId)}/resolve`),
      jsonRequest("POST", { answer: { text: answer }, messageId }, messageId),
      parseResource,
    );
  }

  /** Read fresh and stale structured facts with provenance metadata. 中文：读取带来源信息的新旧结构化事实。 */
  async getMemoryFacts(workspaceId: string): Promise<MemoryFact[]> {
    const query = new URLSearchParams({ includeStale: "true", limit: "100" });
    return this.transport.requestJson(workPath(workspaceId, `memory/facts?${query}`), { method: "GET" }, parseMemoryFacts);
  }

  /** Search durable memory using the Work API's explicit text query. 中文：按明确查询读取持久记忆。 */
  async queryMemory(workspaceId: string, queryText: string): Promise<MemoryFact[]> {
    return this.transport.requestJson(
      workPath(workspaceId, "memory/query"),
      jsonRequest("POST", { query: queryText, limit: 100, includeStale: true }),
      parseMemoryFacts,
    );
  }

  /** Store one user-provided fact with an explicit provenance label. 中文：以明确来源标签保存用户提供的事实。 */
  async saveMemoryFact(workspaceId: string, input: { namespace: string; key: string; value: JsonRecord; sourceId?: string }): Promise<MemoryFact> {
    return this.transport.requestJson(
      workPath(workspaceId, "memory/facts"),
      jsonRequest("POST", input, true),
      parseMemoryFact,
    );
  }

  /** Read the workspace notification outbox without claiming or sending anything. 中文：只读通知发件箱，不租用或发送通知。 */
  async getWorkNotifications(workspaceId: string): Promise<WorkNotification[]> {
    const query = new URLSearchParams({ limit: "100" });
    return this.transport.requestJson(workPath(workspaceId, `notifications?${query}`), { method: "GET" }, parseNotificationList);
  }

  /** Upload one bounded attachment as base64 through the same-origin work proxy. 中文：通过同源 work 代理上传有大小上限的附件。 */
  async uploadWorkAttachment(workspaceId: string, input: WorkSchemas["AttachmentCreate"]): Promise<WorkAttachment> {
    return this.transport.requestJson(workPath(workspaceId, "attachments"), jsonRequest("POST", input, true), parseAttachment);
  }

  /** Download by content digest; no arbitrary URL can be supplied. 中文：按内容摘要下载，不接受任意 URL。 */
  async downloadWorkAttachment(workspaceId: string, sha256: string): Promise<Response> {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new NavigatorContractError("Invalid attachment digest.");
    const response = await this.transport.requestResponse(workPath(workspaceId, `attachments/${sha256}`), { method: "GET" });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { problem = undefined; }
      throw toHttpError(response.status, problem);
    }
    return response;
  }

  /** Read safe connector projections without exposing host credentials. 中文：读取安全连接器投影，不暴露主机凭据。 */
  async getWorkConnectors(workspaceId: string): Promise<WorkConnector[]> {
    return this.transport.requestJson(workPath(workspaceId, "connectors"), { method: "GET" }, parseConnectorList);
  }

  /** Probe the configured QQ binding on the Navigator host. 中文：检查 Navigator 主机上配置的 QQ binding。 */
  async getQqHealth(workspaceId: string, bindingId: string): Promise<QqConnectorHealth> {
    return this.transport.requestJson(workPath(workspaceId, `connectors/${workId(bindingId)}/health`), { method: "GET" }, parseQqHealth);
  }

  /** Request a short-lived QR challenge for the configured QQ binding. 中文：为已配置 QQ binding 请求短时二维码。 */
  async startQqLogin(workspaceId: string, bindingId: string): Promise<QqLoginChallenge> {
    return this.transport.requestJson(
      workPath(workspaceId, `connectors/${workId(bindingId)}/login/qr`),
      jsonRequest("POST", {}, true),
      parseQqLoginChallenge,
    );
  }

  /** Poll the binding-local login state without resubmitting QR data. 中文：查询 binding 本地登录状态，不重传二维码内容。 */
  async pollQqLogin(workspaceId: string, bindingId: string, loginId: string): Promise<QqLoginState> {
    return this.transport.requestJson(
      workPath(workspaceId, `connectors/${workId(bindingId)}/login/poll`),
      jsonRequest("POST", { loginId }, true),
      parseQqLoginState,
    );
  }
}
