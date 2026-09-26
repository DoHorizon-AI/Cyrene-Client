import { createHash } from "node:crypto";
import { z } from "zod";
import type { StateStore } from "../control-storage";
import { ControlError, type Actor } from "../server-control/contracts";
import { compileContribution, packageSchema, type NodePackage } from "./contracts";
import { getDefinition, installDefinitions } from "../pipeline-model/catalog";
import { equal } from "../pipeline-control/service";
import { pipelineRequest } from "../pipeline-control/contracts";
import { catalogCommands } from "./commands";
import type { BuildResult } from "../build-control/contracts";

export const catalogDatabase = z.object({ revision: z.number().int().nonnegative(), packages: z.array(packageSchema), active: z.array(z.string()), updatedBy: z.string(), receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), result: z.object({ revision: z.number(), packageId: z.string(), version: z.string() }) })).default([]) });
export type CatalogDatabase = z.infer<typeof catalogDatabase>;
export const emptyCatalogDatabase = (): CatalogDatabase => ({ revision: 0, packages: [], active: [], updatedBy: "", receipts: [] });
const packageKey = (p: NodePackage) => `${p.id}@${p.version}`;
export class NodeRegistry {
  constructor(private store: StateStore<CatalogDatabase>, private loader: () => Promise<unknown[]>, private resolveBuild?: (buildId: string, workspaceId: string) => Promise<BuildResult>) {}
  async restore() { const state = await this.store.read(); this.install(state); }
  async list() { const { receipts: _, ...catalog } = await this.store.read(); return catalog; }
  async execute(raw: unknown, actor: Actor): Promise<unknown> {
    const request = pipelineRequest.parse(raw);
    if (!Object.hasOwn(catalogCommands, request.name)) throw new ControlError("UNKNOWN_COMMAND", "未知目录操作。");
    const name = request.name as keyof typeof catalogCommands, command = catalogCommands[name], input = command.input.parse(request.input);
    if (!actor.workspaceIds.includes(input.workspaceId) || !actor.scopes.includes(command.scope)) throw new ControlError("FORBIDDEN", "没有节点目录操作权限。", 403);
    if (name === "catalog.list_packages") return this.list();
    const args = catalogCommands["catalog.preview_activation"].input.parse({ workspaceId: input.workspaceId, buildId: "buildId" in input ? input.buildId : undefined, expectedRevision: "expectedRevision" in input ? input.expectedRevision : undefined });
    const key = JSON.stringify([actor.id, input.workspaceId, request.idempotencyKey]), fingerprint = createHash("sha256").update(JSON.stringify([name, input])).digest("hex");
    const replay = (db: CatalogDatabase) => {
      const receipt = db.receipts.find(r => r.key === key);
      if (receipt && receipt.fingerprint !== fingerprint) throw new ControlError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他目录操作。", 409);
      return receipt?.result;
    };
    if (name === "catalog.activate") {
      if (!request.idempotencyKey) throw new ControlError("IDEMPOTENCY_REQUIRED", "启用版本需要幂等键。");
      const previous = replay(await this.store.read()); if (previous) return previous;
    }
    if (!this.resolveBuild) throw new ControlError("BUILD_UNAVAILABLE", "构建结果服务未连接。", 503);
    const result = await this.resolveBuild(args.buildId, args.workspaceId), pkg = packageSchema.parse(result.package);
    const preview = (db: CatalogDatabase) => {
      if (db.revision !== args.expectedRevision) throw new ControlError("REVISION_CONFLICT", "节点目录版本已变化，请重新预览。", 409);
      this.validatePackages([pkg], db);
      const replacing = db.packages.filter(p => p.id === pkg.id && db.active.includes(packageKey(p))).map(packageKey);
      return { fingerprint: createHash("sha256").update(JSON.stringify([db.revision, result, replacing])).digest("hex"), revision: db.revision, package: pkg, replacing };
    };
    if (name === "catalog.preview_activation") return preview(await this.store.read());
    const committed = await this.store.transact(db => {
      const previous = replay(db); if (previous) return { result: previous, db: structuredClone(db) };
      if (catalogCommands["catalog.activate"].input.parse(input).expectedFingerprint !== preview(db).fingerprint) throw new ControlError("ACTIVATION_STALE", "启用预览已失效。", 409);
      if (!db.packages.some(p => packageKey(p) === packageKey(pkg))) db.packages.push(pkg);
      const siblings = new Set(db.packages.filter(p => p.id === pkg.id).map(packageKey));
      db.active = [...db.active.filter(key => !siblings.has(key)), packageKey(pkg)]; db.revision++; db.updatedBy = actor.id;
      const output = { revision: db.revision, packageId: pkg.id, version: pkg.version };
      db.receipts.push({ key, fingerprint, result: output }); return { result: output, db: structuredClone(db) };
    });
    this.install(committed.db); return committed.result;
  }
  private validatePackages(packages: NodePackage[], db: CatalogDatabase) {
    const identities = new Set<string>(), owners = new Map<string, string>();
    for (const pkg of db.packages) for (const node of pkg.nodes) owners.set(node.type, pkg.id);
    for (const pkg of packages) {
      const old = db.packages.find(p => packageKey(p) === packageKey(pkg));
      if (old && !equal(old, pkg)) throw new ControlError("IMMUTABLE_PACKAGE", "已发布的能力包版本不可覆盖。", 409);
      for (const node of pkg.nodes) {
        compileContribution(node, pkg); const key = `${node.type}@${node.version}`;
        if (identities.has(key)) throw new ControlError("DUPLICATE_TYPE", `重复节点类型：${key}`);
        identities.add(key);
        if (getDefinition(node.type) && !getDefinition(node.type)?.packageRef) throw new ControlError("BUILTIN_TYPE", "扩展不能覆盖内置节点。");
        if (owners.has(node.type) && owners.get(node.type) !== pkg.id) throw new ControlError("TYPE_OWNER_CONFLICT", "节点类型不能由其他能力包接管。", 409);
        owners.set(node.type, pkg.id);
        const previous = db.packages.flatMap(p => p.nodes).find(n => n.type === node.type && n.version === node.version);
        if (previous && !equal(previous, node)) throw new ControlError("IMMUTABLE_TYPE", "节点契约变化需要新类型版本。", 409);
      }
    }
  }
  async reload(actor: Actor) {
    if (!actor.scopes.includes("catalog.write")) throw new ControlError("FORBIDDEN", "需要节点目录管理权限。", 403);
    const packages = (await this.loader()).map(value => packageSchema.parse(value));
    const state = await this.store.transact(db => {
      this.validatePackages(packages, db);
      for (const pkg of packages) {
        const old = db.packages.find(p => packageKey(p) === packageKey(pkg));
        if (!old) db.packages.push(pkg);
      }
      db.active = packages.map(packageKey); db.revision++; db.updatedBy = actor.id;
      return structuredClone(db);
    });
    this.install(state); return { revision: state.revision, digest: createHash("sha256").update(JSON.stringify(state.packages)).digest("hex") };
  }
  private install(state: CatalogDatabase) {
    // Old versions remain available to documents. Active packages are installed
    // last so new nodes use the operator-selected current implementation.
    const compile = (packages: NodePackage[]) => packages.flatMap(pkg => pkg.nodes.map(node => compileContribution(node, pkg)));
    installDefinitions(compile(state.packages), compile(state.packages.filter(p => state.active.includes(packageKey(p)))));
  }
}
