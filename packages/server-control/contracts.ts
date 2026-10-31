import { z } from "zod";

export const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const label = z.string().trim().min(1).max(100);
// A registration is user intent, never a Platform NodeRef or a resource lease.
// 注册表示用户意图，不代表 Platform NodeRef 或资源租约。
export const serverSpec = z.object({
  name: label,
  attachment: z.enum(["HOST_AGENT", "CONTAINER_AGENT", "PROVIDER_MANAGED"]),
  provider: label,
  region: z.string().trim().max(100),
  connectionRef: identifier,
}).strict();
export const serverRecord = serverSpec.extend({
  id: identifier, workspaceId: identifier, revision: z.number().int().positive(),
  archived: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type ServerRecord = z.infer<typeof serverRecord>;
export type ServerSpec = z.infer<typeof serverSpec>;
export const observation = z.object({
  serverId: identifier,
  state: z.enum(["UNCONNECTED", "ONLINE", "OFFLINE", "STALE"]),
  observedAt: z.string().datetime().nullable(),
  nodeRef: z.object({ nodeId: identifier, epoch: z.string().regex(/^\d+$/) }).strict().nullable(),
  capabilities: z.array(z.enum(["inventory.read", "metrics.read"])),
  message: z.string().max(500),
}).strict();
export type Observation = z.infer<typeof observation>;
export const resolvedServerSchema = z.object({ serverId: identifier, revision: z.number().int().positive(), nodeRef: observation.shape.nodeRef.unwrap() }).strict();
export type ResolvedServer = z.infer<typeof resolvedServerSchema>;
export const auditEvent = z.object({
  sequence: z.number().int().positive(), requestId: identifier,
  workspaceId: identifier, actorId: identifier, command: z.string(),
  serverId: identifier, revision: z.number().int().positive(), at: z.string().datetime(),
}).strict();
const workspace = z.object({ workspaceId: identifier }).strict();
const target = workspace.extend({ serverId: identifier });
const mutation = target.extend({ expectedRevision: z.number().int().positive().describe("Current registration revision from servers_list/servers_resolve. A changed revision is rejected; reread before preparing a new write.") });
export const commands = {
  "servers.list": { requiredScopes: ["servers.read"], effects: "read", external: false, input: workspace, output: z.object({ items: z.array(serverRecord) }).strict(), scope: "servers.read", readOnly: true, description: "列出工作空间的服务器登记及修订号，登记不代表已在线或已分配算力。" },
  "servers.status": { requiredScopes: ["servers.read"], effects: "read", external: true, input: target, output: observation, scope: "servers.read", readOnly: true, description: "查询当前服务器的权威在线观测和可用监控能力，不连接远程 shell 或申请资源。" },
  "servers.resolve": { requiredScopes: ["servers.read"], effects: "read", external: true, input: target, output: resolvedServerSchema, scope: "servers.read", readOnly: true, description: "核对当前登记与在线 Node 身份；返回登记版本及 Node epoch，不申请资源租约。" },
  "servers.events": { requiredScopes: ["servers.read"], effects: "read", external: false, input: workspace.extend({ after: z.number().int().nonnegative().default(0).describe("Last nextCursor from servers_events; use 0 for the initial audit page. Events strictly after this sequence are returned.") }), output: z.object({ items: z.array(auditEvent), nextCursor: z.number().int().nonnegative().describe("Pass this durable audit sequence as after on the next servers_events read.") }).strict(), scope: "servers.read", readOnly: true, description: "按持久化游标读取服务器登记变更审计；返回 nextCursor 用于继续读取。" },
  "servers.register": { requiredScopes: ["servers.write"], effects: "additive", external: false, input: workspace.extend({ spec: serverSpec }), output: serverRecord, scope: "servers.write", readOnly: false, description: "登记连接引用和资源意向；不安装 Agent、不连接服务器，也不申请资源租约。" },
  "servers.update": { requiredScopes: ["servers.write"], effects: "update", external: false, input: mutation.extend({ spec: serverSpec }), output: serverRecord, scope: "servers.write", readOnly: false, description: "按当前 expectedRevision 更新服务器登记；不改变外部任务或服务器配置。" },
  "servers.archive": { requiredScopes: ["servers.write"], effects: "destructive", external: false, input: mutation, output: serverRecord, scope: "servers.write", readOnly: false, description: "按当前 expectedRevision 归档服务器登记；不会停机、停止任务或删除外部资源。" },
} as const;
export type CommandName = keyof typeof commands;
export type Output<N extends CommandName> = z.infer<(typeof commands)[N]["output"]>;
export const commandRequest = z.object({
  name: z.enum(["servers.list", "servers.status", "servers.resolve", "servers.events", "servers.register", "servers.update", "servers.archive"]),
  input: z.unknown(), requestId: identifier, idempotencyKey: identifier.optional(),
}).strict();
// Supplied by a trusted transport, not by the model/browser request body.
// 由可信传输层提供，不从模型或浏览器请求正文中接收。
export interface Actor { id: string; workspaceIds: string[]; scopes: string[] }
export class ControlError extends Error {
  constructor(public code: string, message: string, public status = 400,
    public details?: { existingRunId?: string; existingBuildId?: string },
    public outcome: "rejected" | "unknown" = "rejected") { super(message); }
}
