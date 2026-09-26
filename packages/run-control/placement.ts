import { ControlError, resolvedServerSchema, type ResolvedServer } from "../server-control/contracts";
import type { ServerControl } from "../server-control/service";
import type { Placement } from "./contracts";

export interface PlacementResolver {
  resolve(workspaceId: string, placement: Placement): Promise<ResolvedServer[]>;
}

/** Resolves intent to observed identities. Product/Platform still grant leases. */
export class RegisteredPlacementResolver implements PlacementResolver {
  constructor(private servers: Pick<ServerControl, "execute">) {}
  async resolve(workspaceId: string, placement: Placement) {
    if (placement.serverId && placement.pool?.length && !placement.pool.includes(placement.serverId)) throw new ControlError("PLACEMENT_CONFLICT", "指定服务器不在资源池中。", 409);
    const ids = placement.serverId ? [placement.serverId] : [...new Set(placement.pool ?? [])].sort();
    const actor = { id: "studio-coordinator", workspaceIds: [workspaceId], scopes: ["servers.read"] };
    return Promise.all(ids.map(async serverId => resolvedServerSchema.parse(await this.servers.execute({ name: "servers.resolve", input: { workspaceId, serverId }, requestId: crypto.randomUUID() }, actor))));
  }
}
