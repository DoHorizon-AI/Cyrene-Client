import { describe, expect, it, vi } from "vitest";
import { updateHelperResultSchema } from "../../packages/component-updates/contracts";
import { createUpdateControl } from "../../apps/control/update-control";
import { resolveUpdateHelperCommand } from "../../apps/control/update-helper";

const localActor = { id: "local-user", workspaceIds: ["local"], scopes: ["updates.read", "updates.apply"] };
const idleResult = updateHelperResultSchema.parse({ status: "ready", components: [] });

describe("component update commands", () => {
  it("uses the fixed Polkit wrapper chain on Linux and rejects executable overrides", () => {
    expect(resolveUpdateHelperCommand({}, "linux")).toEqual({
      executable: "/usr/bin/pkexec",
      args: ["/usr/libexec/cyrene-component-update-helper"],
    });
    expect(() => resolveUpdateHelperCommand({ STUDIO_UPDATE_HELPER_PATH: "/tmp/custom-helper" }, "linux")).toThrow("Linux 更新 helper 固定");
  });

  it("dispatches fixed local operations over the helper protocol", async () => {
    const helper = vi.fn(async () => idleResult);
    const updates = createUpdateControl(helper);

    await updates.execute({ name: "updates.check", input: {}, requestId: "request-1" }, localActor);

    expect(helper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.component-updates.helper.v1",
      operation: "check",
    });
  });

  it("rejects a confirmation that does not bind the plan digest", async () => {
    const helper = vi.fn(async () => idleResult);
    const updates = createUpdateControl(helper);

    await expect(updates.execute({
      name: "updates.apply",
      input: {
        planId: "plan-1",
        planDigest: `sha256:${"a".repeat(64)}`,
        confirmation: { planId: "plan-1", planDigest: `sha256:${"b".repeat(64)}`, confirmed: true },
      },
      requestId: "request-2",
    }, localActor)).rejects.toThrow();
    expect(helper).not.toHaveBeenCalled();
  });

  it("does not let Web callers select arbitrary component operations", async () => {
    const helper = vi.fn(async () => idleResult);
    const updates = createUpdateControl(helper);

    await expect(updates.execute({ name: "updates.check", input: { componentIds: ["../shell"] }, requestId: "request-3" }, localActor)).rejects.toThrow();
    expect(helper).not.toHaveBeenCalled();
  });

  it("allows catalog identifiers outside the Windows Product subset for the platform helper to resolve", async () => {
    const helper = vi.fn(async () => idleResult);
    const updates = createUpdateControl(helper);

    await updates.execute({ name: "updates.check", input: { componentIds: ["cyrene-kernel"] }, requestId: "request-5" }, localActor);

    expect(helper).toHaveBeenCalledWith({
      protocolVersion: "cyrene.component-updates.helper.v1",
      operation: "check",
      componentIds: ["cyrene-kernel"],
    });
  });

  it("requires local update scopes before invoking the helper", async () => {
    const helper = vi.fn(async () => idleResult);
    const updates = createUpdateControl(helper);

    await expect(updates.execute({ name: "updates.apply", input: {}, requestId: "request-4" }, { ...localActor, scopes: ["updates.read"] })).rejects.toThrow("本机组件更新权限");
    expect(helper).not.toHaveBeenCalled();
  });
});
