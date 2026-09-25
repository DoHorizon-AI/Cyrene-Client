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
export const auditEvent = z.object({
  sequence: z.number().int().positive(), requestId: identifier,
  workspaceId: identifier, actorId: identifier, command: z.string(),
  serverId: identifier, revision: z.number().int().positive(), at: z.string().datetime(),
}).strict();
const workspace = z.object({ workspaceId: identifier }).strict();
const target = workspace.extend({ serverId: identifier });
const mutation = target.extend({ expectedRevision: z.number().int().positive() });
export const commands = {
  "servers.list": { input: workspace, output: z.object({ items: z.array(serverRecord) }).strict(), scope: "servers.read", readOnly: true },
  "servers.status": { input: target, output: observation, scope: "servers.read", readOnly: true },
  "servers.events": { input: workspace.extend({ after: z.number().int().nonnegative().default(0) }), output: z.object({ items: z.array(auditEvent), nextCursor: z.number().int().nonnegative() }).strict(), scope: "servers.read", readOnly: true },
  "servers.register": { input: workspace.extend({ spec: serverSpec }), output: serverRecord, scope: "servers.write", readOnly: false },
  "servers.update": { input: mutation.extend({ spec: serverSpec }), output: serverRecord, scope: "servers.write", readOnly: false },
  "servers.archive": { input: mutation, output: serverRecord, scope: "servers.write", readOnly: false },
} as const;
export type CommandName = keyof typeof commands;
export type Output<N extends CommandName> = z.infer<(typeof commands)[N]["output"]>;
export const commandRequest = z.object({
  name: z.enum(["servers.list", "servers.status", "servers.events", "servers.register", "servers.update", "servers.archive"]),
  input: z.unknown(), requestId: identifier, idempotencyKey: identifier.optional(),
}).strict();
// Supplied by a trusted transport, not by the model/browser request body.
// 由可信传输层提供，不从模型或浏览器请求正文中接收。
export interface Actor { id: string; workspaceIds: string[]; scopes: string[] }
export class ControlError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
