import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import type { StateStore } from "../control-storage";
import { ControlError, identifier, type Actor } from "../server-control/contracts";

const role = z.enum(["viewer", "editor", "operator", "admin"]);
const member = z.object({ id: identifier, username: z.string(), passwordHash: z.string(), workspaceIds: z.array(identifier), roles: z.array(role), disabled: z.boolean() });
const session = z.object({ digest: z.string(), userId: identifier, csrf: z.string(), expiresAt: z.number(), kind: z.enum(["browser", "api"]), scopes: z.array(z.string()).optional() });
export const teamDatabase = z.object({ version: z.literal(1), members: z.array(member), sessions: z.array(session), audit: z.array(z.object({ at: z.string(), actorId: z.string(), action: z.string(), subject: z.string() })) });
export type TeamDatabase = z.infer<typeof teamDatabase>;
export const emptyTeamDatabase = (): TeamDatabase => ({ version: 1, members: [], sessions: [], audit: [] });
const memberInput = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_.@-]{1,100}$/), password: z.string().min(12).max(256), workspaceIds: z.array(identifier).min(1).max(50), roles: z.array(role).min(1).max(4) }).strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const kdf = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
const permissions: Record<z.infer<typeof role>, string[]> = {
  viewer: ["pipelines.read", "servers.read", "runs.read", "builds.read"],
  editor: ["pipelines.read", "pipelines.write", "servers.read", "runs.read", "builds.read", "builds.write"],
  operator: ["pipelines.read", "servers.read", "runs.read", "runs.write", "builds.read"],
  admin: ["pipelines.read", "pipelines.write", "servers.read", "servers.write", "runs.read", "runs.write", "team.admin", "catalog.write", "builds.read", "builds.write"],
};
function actorOf(m: z.infer<typeof member>): Actor { return { id: m.id, workspaceIds: m.workspaceIds, scopes: [...new Set(m.roles.flatMap(r => permissions[r]))] }; }
function admin(actor: Actor) { if (!actor.scopes.includes("team.admin")) throw new ControlError("FORBIDDEN", "需要团队管理权限。", 403); }

export class TeamControl {
  constructor(private store: StateStore<TeamDatabase>, private now = () => Date.now()) {}
  async bootstrap(username: string, password: string, workspaceId = "local") {
    const input = memberInput.parse({ username, password, workspaceIds: [workspaceId], roles: ["admin"] });
    const prepared = await this.prepare(input);
    return this.store.transact(db => {
      if (db.members.length) throw new ControlError("ALREADY_INITIALIZED", "团队已经初始化，不能覆盖管理员。", 409);
      db.members.push(prepared);
      return this.publicMember(prepared);
    });
  }
  async createMember(raw: unknown, actor: Actor) {
    admin(actor);
    const input = memberInput.parse(raw);
    if (input.workspaceIds.some(id => !actor.workspaceIds.includes(id))) throw new ControlError("FORBIDDEN", "不能授予未管理的工作空间。", 403);
    const prepared = await this.prepare(input);
    return this.store.transact(db => {
      if (db.members.some(m => m.username === input.username)) throw new ControlError("ALREADY_EXISTS", "成员名已存在。", 409);
      db.members.push(prepared);
      db.audit.push({ at: new Date(this.now()).toISOString(), actorId: actor.id, action: "members.create", subject: prepared.id });
      return this.publicMember(prepared);
    });
  }
  async list(actor: Actor) { admin(actor); return (await this.store.read()).members.filter(m => m.workspaceIds.some(id => actor.workspaceIds.includes(id))).map(m => this.publicMember(m)); }
  async login(username: string, password: string) {
    if (username.length > 100 || password.length > 256) throw new ControlError("UNAUTHENTICATED", "用户名或密码错误。", 401);
    const found = (await this.store.read()).members.find(m => m.username === username && !m.disabled);
    const [salt, expected] = (found?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`).split(":");
    const actual = await kdf(password, salt);
    if (!found || !timingSafeEqual(actual, Buffer.from(expected, "hex"))) throw new ControlError("UNAUTHENTICATED", "用户名或密码错误。", 401);
    return this.issue(found.id, "browser", 8 * 60 * 60 * 1000);
  }
  async authenticate(token: string, kind: "browser" | "api") {
    const db = await this.store.read(), found = db.sessions.find(s => s.digest === digest(token) && s.kind === kind && s.expiresAt > this.now());
    const member = found && db.members.find(m => m.id === found.userId && !m.disabled);
    if (!found || !member) throw new ControlError("UNAUTHENTICATED", "登录已失效，请重新登录。", 401);
    const actor = actorOf(member);
    if (found.scopes) actor.scopes = actor.scopes.filter(scope => found.scopes!.includes(scope));
    return { actor, csrf: found.csrf, expiresAt: found.expiresAt, username: member.username };
  }
  async issueApiToken(actor: Actor, scopes: string[]) {
    if (!scopes.length || scopes.some(s => !actor.scopes.includes(s)) || scopes.includes("team.admin")) throw new ControlError("FORBIDDEN", "API 凭据必须限定在当前权限内，不能包含团队管理权限。", 403);
    return this.issue(actor.id, "api", 24 * 60 * 60 * 1000, scopes);
  }
  async logout(token: string) { await this.store.transact(db => { db.sessions = db.sessions.filter(s => s.digest !== digest(token)); }); }
  private async prepare(input: z.infer<typeof memberInput>): Promise<z.infer<typeof member>> {
    const salt = randomBytes(16).toString("hex"), hash = (await kdf(input.password, salt)).toString("hex");
    return { id: crypto.randomUUID(), username: input.username, passwordHash: `${salt}:${hash}`, workspaceIds: input.workspaceIds, roles: input.roles, disabled: false };
  }
  private publicMember({ passwordHash: _, ...value }: z.infer<typeof member>) { return value; }
  private async issue(userId: string, kind: "browser" | "api", ttl: number, scopes?: string[]) {
    const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex"), expiresAt = this.now() + ttl;
    await this.store.transact(db => {
      if (!db.members.some(m => m.id === userId && !m.disabled)) throw new ControlError("UNAUTHENTICATED", "成员不可用。", 401);
      db.sessions = db.sessions.filter(s => s.expiresAt > this.now());
      if (db.sessions.filter(s => s.userId === userId).length >= 100) throw new ControlError("SESSION_LIMIT", "请先注销旧会话。", 409);
      db.sessions.push({ digest: digest(token), userId, csrf, expiresAt, kind, scopes });
    });
    return { token, csrf, expiresAt };
  }
}
