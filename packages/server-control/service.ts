import { z } from "zod";
import { auditEvent, commands, commandRequest, ControlError, observation, serverRecord, type Actor, type Observation, type ServerRecord } from "./contracts";

export const databaseSchema = z.object({
  version: z.literal(1), servers: z.array(serverRecord), events: z.array(auditEvent),
  receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), result: serverRecord }).strict()),
}).strict();
export type Database = z.infer<typeof databaseSchema>;
export const emptyDatabase = (): Database => ({ version: 1, servers: [], events: [], receipts: [] });
export interface RegistryStore {
  read(): Promise<Database>;
  transact<T>(operation: (db: Database) => T): Promise<T>;
}
// Implementations resolve preconfigured connectionRef values on the server.
// Credentials, endpoints and Platform wire protocols do not enter graph documents.
// 实现应在服务端解析预先配置的 connectionRef。凭据、端点和 Platform 线协议不会进入流程图文档。
export interface ServerObserver { read(server: ServerRecord, actor: Actor): Promise<Observation> }
export class ServerControl {
  constructor(private store: RegistryStore, private observers: ReadonlyMap<string, ServerObserver> = new Map()) {}

  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = commandRequest.parse(raw), definition = commands[request.name];
    const input = definition.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(definition.scope)) {
      throw new ControlError("FORBIDDEN", "没有此工作空间的操作权限。", 403);
    }
    if (definition.readOnly) {
      const db = await this.store.read();
      if (request.name === "servers.list") return { items: db.servers.filter(s => s.workspaceId === input.workspaceId) };
      if (request.name === "servers.events") {
        const args = commands["servers.events"].input.parse(input);
        const items = db.events.filter(e => e.workspaceId === args.workspaceId && e.sequence > args.after).slice(0, 100);
        return { items, nextCursor: items.at(-1)?.sequence ?? args.after };
      }
      const args = commands["servers.status"].input.parse(input);
      const server = this.find(db, args.workspaceId, args.serverId);
      if (request.name === "servers.resolve") {
        if (server.archived) throw new ControlError("ARCHIVED", "服务器登记已归档。", 409);
        const status = observation.parse(await this.execute({ name: "servers.status", input: args, requestId: request.requestId }, actor));
        const latest = this.find(await this.store.read(), args.workspaceId, args.serverId);
        if (latest.revision !== server.revision || latest.archived) throw new ControlError("REVISION_CONFLICT", "观测期间服务器登记发生变化，请重新预检。", 409);
        if (status.state !== "ONLINE" || !status.nodeRef) throw new ControlError("SERVER_UNAVAILABLE", "服务器尚未取得新鲜的在线 Node 身份，不能用于执行。", 409);
        return { serverId: server.id, revision: server.revision, nodeRef: status.nodeRef };
      }
      const adapter = !server.archived && this.observers.get(server.connectionRef);
      if (!adapter) return observation.parse({ serverId: server.id, state: "UNCONNECTED", observedAt: null, nodeRef: null, capabilities: [], message: server.archived ? "登记已归档。" : "已登记；连接适配器尚未接入，没有实时资源观测。" });
      const result = observation.parse(await adapter.read(server, actor));
      if (result.serverId !== server.id) throw new ControlError("IDENTITY_MISMATCH", "资源观测身份不匹配。", 502);
      const age = result.observedAt ? Date.now() - Date.parse(result.observedAt) : Infinity;
      if (age < -5000) throw new ControlError("INVALID_OBSERVATION", "资源观测时间异常。", 502);
      if (result.state === "ONLINE" && (!result.nodeRef || age > 60_000)) return { ...result, state: "STALE", capabilities: [], message: "资源身份尚未确认或观测已过期，请重新连接。" };
      return result;
    }
    if (!request.idempotencyKey) throw new ControlError("IDEMPOTENCY_REQUIRED", "写操作需要幂等键。");
    // Parsed object ordering is stable, including nested spec fields.
    // 解析后的对象顺序保持稳定，包括嵌套的 spec 字段。
    const key = JSON.stringify([actor.id, input.workspaceId, request.idempotencyKey]);
    const fingerprint = JSON.stringify([request.name, input]);
    return this.store.transact(db => {
      const previous = db.receipts.find(r => r.key === key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ControlError("IDEMPOTENCY_CONFLICT", "该幂等键已用于不同的操作。", 409);
        return previous.result;
      }
      if (db.events.length >= 10_000) throw new ControlError("STORE_LIMIT", "本地登记库已达到原型容量上限，请迁移存储。", 409);
      const at = new Date().toISOString();
      let result: ServerRecord;
      if (request.name === "servers.register") {
        const args = commands["servers.register"].input.parse(input);
        result = { ...args.spec, id: crypto.randomUUID(), workspaceId: args.workspaceId, revision: 1, archived: false, createdAt: at, updatedAt: at };
        db.servers.push(result);
      } else {
        const args = request.name === "servers.update" ? commands["servers.update"].input.parse(input) : commands["servers.archive"].input.parse(input);
        const current = this.find(db, args.workspaceId, args.serverId);
        if (current.revision !== args.expectedRevision) throw new ControlError("REVISION_CONFLICT", "登记已被修改，请刷新列表并重新选择服务器后再编辑。", 409);
        if (current.archived) throw new ControlError("ARCHIVED", "登记已归档，不能继续修改。", 409);
        const changes = request.name === "servers.update" ? commands["servers.update"].input.parse(input).spec : { archived: true };
        result = { ...current, ...changes, revision: current.revision + 1, updatedAt: at };
        db.servers[db.servers.findIndex(s => s.id === current.id)] = result;
      }
      db.events.push({ sequence: (db.events.at(-1)?.sequence ?? 0) + 1, workspaceId: input.workspaceId, actorId: actor.id, command: request.name, requestId: request.requestId, serverId: result.id, revision: result.revision, at });
      db.receipts.push({ key, fingerprint, result });
      return result;
    });
  }
  private find(db: Database, workspaceId: string, id: string) {
    const item = db.servers.find(s => s.workspaceId === workspaceId && s.id === id);
    if (!item) throw new ControlError("NOT_FOUND", "未找到此工作空间的服务器登记。", 404);
    return item;
  }
}
