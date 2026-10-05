import { describe, expect, it } from "vitest";
import { MonitoringControl } from "../../packages/monitoring/service";
import { examplePipeline } from "../../packages/pipeline-model";
import { emptyPipelineDatabase } from "../../packages/pipeline-control/service";
import { emptyRunDatabase, runSchema } from "../../packages/run-control/contracts";
import { monitorRows } from "../../apps/web/src/monitoring/model";
import { productPermission } from "../../tooling/product-proxy";
import { createMcpServer } from "../../apps/mcp/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const actor = { id: "viewer", workspaceIds: ["local"], scopes: ["pipelines.read", "runs.read"] };
function fixture() {
  const document = examplePipeline(), pipelines = emptyPipelineDatabase(), runs = emptyRunDatabase();
  pipelines.records.push({ workspaceId: "local", document, graphRevision: 2, layoutRevision: 1, updatedAt: new Date().toISOString(), updatedBy: "owner" });
  for (const [id, state, workspaceId, at] of [["active", "running", "local", "03"], ["latest", "failed", "local", "02"], ["old", "succeeded", "local", "01"], ["private", "running", "other", "04"]] as const) {
    runs.runs.push(runSchema.parse({ id, state, workspaceId, pipelineId: document.id, graphRevision: 1, revision: 1, document: { ...document, name: "Original name" }, createdAt: `2026-09-27T00:00:${at}.000Z`, createdBy: "owner", placements: {}, steps: document.nodes.map(node => ({ nodeId: node.id, adapter: "fixture", state: "running", config: { secret: "do-not-project" }, actualConfig: {}, generation: 1, retries: 0, inputs: {}, outputs: {} })) }));
  }
  return { document, pipelines, runs, control: new MonitoringControl({ read: async () => pipelines }, { read: async () => runs }) };
}
describe("workspace monitoring", () => {
  it("exposes the same read-only projection through MCP and enforces both read scopes", async () => {
    const f = fixture(), unused = { execute: async () => ({}) };
    for (const scopes of [["pipelines.read", "runs.read"], ["runs.read"]]) {
      const server = createMcpServer(unused, { ...actor, scopes }, unused, { monitoring: f.control, readOnly: true });
      const client = new Client({ name: "monitor-test", version: "1" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a); await client.connect(b);
      try {
        const { tools } = await client.listTools();
        expect(tools.some(tool => tool.name === "monitoring.snapshot")).toBe(scopes.includes("pipelines.read"));
        if (scopes.includes("pipelines.read")) {
          const result = await client.callTool({ name: "monitoring.snapshot", arguments: { workspaceId: "local" } });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toMatchObject({ workspaceId: "local" });
          expect((await client.callTool({ name: "monitoring.snapshot", arguments: { workspaceId: "other" } })).isError).toBe(true);
        }
      } finally { await client.close(); await server.close(); }
    }
  });
  it("projects only authorized summaries, all active runs and the latest terminal run", async () => {
    const f = fixture();
    const result = await f.control.execute({ name: "monitoring.snapshot", requestId: "read", input: { workspaceId: "local" } }, actor);
    expect(result.runs.map(run => run.id)).toEqual(["active", "latest"]);
    expect(JSON.stringify(result)).not.toContain("do-not-project");
    expect(JSON.stringify(result)).not.toContain("actualConfig");
    expect(result.runs[0].pipelineName).toBe("Original name");
    expect(result.pipelines[0].graphRevision).toBe(2);
    const history = await f.control.execute({ name: "monitoring.snapshot", requestId: "history", input: { workspaceId: "local", history: true } }, actor);
    expect(history.runs.map(run => run.id)).toEqual(["active", "latest", "old"]);
    await expect(f.control.execute({ name: "monitoring.snapshot", requestId: "denied", input: { workspaceId: "other" } }, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.control.execute({ name: "monitoring.snapshot", requestId: "denied", input: { workspaceId: "local" } }, { ...actor, scopes: ["runs.read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not lose active deleted nodes or confuse a draft with an immutable run", async () => {
    const f = fixture();
    const snapshot = await f.control.execute({ name: "monitoring.snapshot", requestId: "read", input: { workspaceId: "local" } }, actor);
    const edited = { ...f.document, nodes: f.document.nodes.filter(node => node.id !== "training") };
    const rows = monitorRows(snapshot, edited, true, false, false);
    expect(rows.find(row => row.id === "training" && row.runId === "active")?.removed).toBe(true);
    expect(rows.some(row => row.id === "training" && row.runId === "latest")).toBe(false);
    expect(monitorRows(snapshot, edited, true, false, true).some(row => row.id === "training" && row.runId === "latest")).toBe(true);
    const fresh = { ...f.document, id: "unsaved-pipeline" };
    const draftRows = monitorRows(snapshot, fresh, true, true, false);
    expect(draftRows.every(row => !row.runId && row.draft)).toBe(true);
    expect(draftRows.find(row => row.type === "model")?.state).toBe("reference");
    expect(snapshot.pipelines[0].nodes.some(node => node.id === "training")).toBe(true);
  });
});
describe("Product operation boundary", () => {
  it("separates reads, edits, execution, administration and streaming endpoints", () => {
    expect(productPermission("GET", "/api/v1/yield/training-runs/job/events/stream")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/catalyst/datasets/data/preparations")).toBe("products.write");
    expect(productPermission("POST", "/api/v1/yield/training-drafts/draft/actions/start")).toBe("products.operate");
    expect(productPermission("POST", "/api/v1/exchange/api/v1/api-keys")).toBe("products.admin");
    expect(productPermission("POST", "/api/proxy/exchange-gateway/v1/chat/completions")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/navigator/tasks")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/navigator/tasks")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/navigator/tasks/task-1/events")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/navigator/tasks/task-1/cancel")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/navigator/approvals")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/navigator/approvals/approval-1/resolve")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/approvals")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/approvals/approval-1/resolve")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/inputs")).toBe("products.read");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/inputs/input-1")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/inputs/input-1/resolve")).toBe("products.operate");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/memory/facts")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/memory/facts")).toBe("products.write");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/notifications")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/attachments")).toBe("products.write");
    expect(productPermission("GET", `/api/v1/workspaces/ws-1/work/attachments/${"a".repeat(64)}`)).toBe("products.read");
    expect(productPermission("GET", "/api/v1/workspaces/ws-1/work/connectors/qq-main/health")).toBe("products.read");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/connectors/qq-main/login/qr")).toBe("products.operate");
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/connectors/qq-main/login/poll")).toBe("products.operate");
    for (const path of ["/api%2fv1/yield/training-runs/x", "/api/v1/reactor/../credentials", "/api/v1/yield/training-drafts/%252e/actions/start", "/api/v1/yield/admin", "/api/v1/yield/training-runs/x/actions/delete"]) expect(productPermission("POST", path)).toBeNull();
    expect(productPermission("POST", "/api/v1/navigator/tasks/task-1/actions/retry")).toBeNull();
    expect(productPermission("POST", "/api/v1/workspaces/ws-1/work/connectors/qq-main/login/launch-command")).toBeNull();
  });
});
