import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { assistantTurn, validateProvider } from "../../apps/control/assistant";
import { createMcpServer } from "../../apps/mcp/server";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const actor = { id: "editor", workspaceIds: ["local"], scopes: ["pipelines.read", "pipelines.write"] };
it("sends only authorized tool schemas to the configured model and returns proposals without executing them", async () => {
  let requests = 0, executions = 0, received: any;
  const upstream = createServer(async (req, res) => {
    requests++; const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); received = JSON.parse(Buffer.concat(chunks).toString());
    expect(req.headers.authorization).toBe("Bearer provider-secret");
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "Proposed edit", tool_calls: [{ id: "proposal", type: "function", function: { name: "pipelines__patch", arguments: JSON.stringify({ workspaceId: "local", pipelineId: "test", expectedGraphRevision: 1, expectedLayoutRevision: 1, edits: [{ op: "rename", name: "new name" }], idempotencyKey: "edit-one" }) } }] } }] }));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const provider = { url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/chat/completions`, model: "test-model", apiKey: "provider-secret" };
  const executor = { execute: async () => { executions++; return {}; } };
  const input = { workspaceId: "local", messages: [{ role: "user", content: "Rename the flow" }] };
  const result = await assistantTurn(input, actor, provider, createMcpServer(executor, actor), AbortSignal.timeout(10000));
  expect(result.calls[0]).toMatchObject({ name: "pipelines.patch", readOnly: false });
  expect(executions).toBe(0); expect(requests).toBe(1);
  expect(received.tools.some((t: any) => t.function.name === "pipelines__patch")).toBe(true);
  expect(received.tools.some((t: any) => t.function.name === "runs__start")).toBe(false);
  expect(JSON.stringify(result)).not.toContain("provider-secret");
  await expect(assistantTurn({ ...input, workspaceId: "other" }, actor, provider, createMcpServer(executor, actor), AbortSignal.timeout(10000))).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(requests).toBe(1);
  const viewer = { ...actor, scopes: ["pipelines.read"] };
  await expect(assistantTurn(input, viewer, provider, createMcpServer(executor, viewer), AbortSignal.timeout(10000))).rejects.toMatchObject({ code: "MODEL_TOOL" });
  expect(received.tools.every((t: any) => t.function.name !== "pipelines__patch")).toBe(true);
  expect(executions).toBe(0);
});
it("requires explicit model configuration and rejects unsafe provider URLs", async () => {
  for (const url of ["http://remote.invalid/v1/chat/completions", "https://user:password@api.invalid/v1/chat/completions", "file:///private/key", "https://api.invalid/chat?token=secret"]) expect(() => validateProvider({ url, model: "m" })).toThrow();
  expect(validateProvider({ url: "http://127.0.0.1:1234/v1/chat/completions", model: "m" }).model).toBe("m");
  await expect(assistantTurn({ workspaceId: "local", messages: [{ role: "user", content: "hello" }] }, actor, undefined, createMcpServer({ execute: async () => ({}) }, actor), AbortSignal.timeout(10000))).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
});
