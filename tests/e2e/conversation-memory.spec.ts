import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type FixtureMemory = {
  id: string; version: number; kind: string; text: string; scope: Record<string, unknown>; state: string; indexState: string;
  sourceMessageIds: string[]; sourceRefs: unknown[]; authorizationEpoch: number; createdAt: number; updatedAt: number; validUntil: number | null;
};

const scope = { conversationId: "chat-1", conversationKind: "direct", personaId: null, visibility: "private" };
const originalMessage = {
  id: "message-1", eventId: "event-1", role: "user", content: "Please keep answers concise.", occurredAt: 900,
  status: "active", revokedAt: null, sourceRefs: [], scope,
};

async function mountConversationMemory(page: Page, options: { provider?: "ready" | "unavailable"; readOnly?: boolean; hostWorkspace?: string } = {}) {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  let memory: FixtureMemory = {
    id: "memory-1", version: 1, kind: "preference", text: "Prefers concise answers.", scope, state: "active", indexState: "indexed",
    sourceMessageIds: ["message-1"], sourceRefs: [], authorizationEpoch: 4, createdAt: 1000, updatedAt: 1000, validUntil: null,
  };
  let addedMemory: FixtureMemory | null = null;
  let sourceStatus: "active" | "revoked" = "active";
  let memoryDeleted = false;
  let grants: Array<{ id: string; visibility: "conversation" | "workspace"; targetConversationId: string | null; expiresAt: number | null; createdAt: number; status: "active" | "revoked" }> = [];
  const calls: Array<{ method: string; path: string; query: Record<string, string>; body: unknown; csrf: string | undefined; idempotencyKey: string | undefined }> = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postDataJSON() as unknown;
    calls.push({ method, path, query: Object.fromEntries(url.searchParams.entries()), body, csrf: request.headers()["x-csrf-token"], idempotencyKey: request.headers()["idempotency-key"] });
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session") return reply({ authenticated: true, state: "AUTHENTICATED", sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false });
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "fixture", workspaceId: options.hostWorkspace ?? "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path.endsWith("/conversation-memory/overview")) return reply({ authorizationEpoch: 4, counts: { messages: 1, memories: memoryDeleted ? 0 : 1, sources: 1 }, capabilities: { memoryProvider: options.provider ?? "ready", summarizer: "unavailable" } });
    if (path.endsWith("/conversation-memory/messages") && method === "GET") return reply({ items: [originalMessage], nextCursor: null });
    if (path.endsWith("/conversation-memory/memories/query") && method === "POST") return reply({ items: sourceStatus === "active" && !memoryDeleted ? [{ memoryId: memory.id, version: memory.version, kind: memory.kind, text: memory.text, sourceMessageIds: memory.sourceMessageIds, sourceRefs: [], scope, score: 0.94, stale: false }] : [], authorizationEpoch: sourceStatus === "active" ? 4 : 5 });
    if (path.endsWith("/conversation-memory/memories") && method === "GET") return reply({ items: [memoryDeleted ? null : memory, addedMemory?.state === "active" && sourceStatus === "active" ? addedMemory : null].filter(Boolean), authorizationEpoch: sourceStatus === "active" ? 4 : 5 });
    if (path.endsWith("/conversation-memory/memories") && method === "POST") {
      const input = body as Record<string, unknown>;
      addedMemory = { ...memory, id: "memory-2", version: 1, text: String(input["text"]), sourceMessageIds: input["sourceMessageIds"] as string[], sourceRefs: [], state: "active", indexState: "indexed" };
      return reply({ memory: addedMemory, duplicate: false });
    }
    if (path.endsWith("/conversation-memory/memories/memory-1") && method === "PATCH") {
      const { expectedVersion: _expectedVersion, ...patch } = body as Record<string, unknown>;
      memory = { ...memory, ...patch, version: memory.version + 1, updatedAt: 2000 };
      return reply({ memory });
    }
    if (path.endsWith("/conversation-memory/memories/memory-1") && method === "DELETE") {
      memoryDeleted = true;
      return reply({ deleted: true, authorizationEpoch: 6 });
    }
    if (path.endsWith("/conversation-memory/sources") && method === "GET") return reply({ items: [{ id: "message-1", eventId: "event-1", kind: "conversation_message", role: "user", status: sourceStatus, revokedAt: sourceStatus === "revoked" ? 3000 : null, authorizationEpoch: sourceStatus === "revoked" ? 5 : 4, createdAt: 900, scope, canManageGrants: true, grants }] });
    if (path.endsWith("/conversation-memory/sources/message-1/grants") && method === "POST") {
      const input = body as { visibility: "conversation" | "workspace"; targetConversationId?: string };
      const created = { id: "grant-1", visibility: input.visibility, targetConversationId: input.targetConversationId ?? null, expiresAt: null, createdAt: 2000, status: "active" as const };
      grants = [...grants.filter(item => item.status === "revoked"), created];
      return reply({ grant: created, authorizationEpoch: 5, duplicate: false });
    }
    if (path.endsWith("/conversation-memory/sources/message-1/grants/grant-1") && method === "DELETE") {
      grants = grants.map(item => ({ ...item, status: "revoked" as const }));
      return reply({ revoked: true, authorizationEpoch: 6 });
    }
    if (path.endsWith("/conversation-memory/sources/message-1/revoke") && method === "POST") {
      sourceStatus = "revoked";
      return reply({ sourceId: "message-1", authorizationEpoch: 5, invalidatedCount: 1 });
    }
    return reply({ code: "NOT_FOUND", detail: `No fixture route for ${method} ${path}.` }, 404);
  });
  await page.goto(`/?fixture=conversation-memory${options.readOnly ? "&readonly=1" : ""}`);
  return { calls };
}

test("SIMULATED browser flow searches, corrects, revokes, and deletes attributed memory", async ({ page }) => {
  const { calls } = await mountConversationMemory(page);
  page.on("dialog", dialog => dialog.accept());

  await page.getByLabel("Conversation ID", { exact: true }).fill("chat-1");
  await page.getByRole("button", { name: "Load scope", exact: true }).click();
  await expect(page.getByText("Prefers concise answers.").first()).toBeVisible();
  await page.getByLabel("Semantic query", { exact: true }).fill("concise");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".conversation-memory__list").filter({ hasText: "0.940" })).toContainText("message-1");
  await page.getByRole("button", { name: "Open record", exact: true }).click();

  await page.getByRole("button", { name: "Read messages", exact: true }).click();
  await expect(page.getByText("Please keep answers concise.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View sources", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Use as evidence", exact: true })).toBeChecked();

  await page.getByLabel("Memory text", { exact: true }).fill("The user prefers concise answers.");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.locator(".conversation-memory__list > li").filter({ hasText: "The user prefers concise answers." })).toBeVisible();

  const originalMemory = page.locator(".conversation-memory__list > li").filter({ hasText: "memory-1" });
  await originalMemory.getByRole("button", { name: "Correct", exact: true }).click();
  await page.getByRole("textbox", { name: "Corrected text", exact: true }).fill("Prefers short answers.");
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(originalMemory).toContainText("Prefers short answers.");
  await expect(originalMemory).toContainText("memory-1 · v2 · active");

  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.getByText("Prefers concise answers.", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Grant sharing", exact: true }).click();
  await page.getByLabel("Target conversation ID", { exact: true }).fill("chat-2");
  await page.getByRole("button", { name: "Grant access", exact: true }).click();
  await expect(page.locator(".conversation-memory__grant")).toContainText("chat-2");
  await page.getByRole("button", { name: "Revoke grant", exact: true }).click();
  await expect(page.getByText("Grant revoked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Revoke source", exact: true }).click();
  await expect(page.getByText("user · revoked", { exact: true })).toBeVisible();
  await page.getByLabel("Semantic query", { exact: true }).fill("concise");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No memory matches", { exact: true })).toBeVisible();

  await expect(page.getByText("No memories in this scope", { exact: true })).toBeVisible();
  expect(calls.some(call => call.method === "PATCH" && call.path.endsWith("/memories/memory-1"))).toBe(true);
  expect(calls.find(call => call.method === "PATCH" && call.path.endsWith("/memories/memory-1"))?.body).toMatchObject({ expectedVersion: 1 });
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/sources/message-1/grants"))).toBe(true);
  expect(calls.some(call => call.method === "DELETE" && call.path.endsWith("/sources/message-1/grants/grant-1"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/sources/message-1/revoke"))).toBe(true);
  expect(calls.some(call => call.method === "DELETE" && call.path.endsWith("/memories/memory-1"))).toBe(true);
  expect(calls.find(call => call.method === "DELETE" && call.path.endsWith("/memories/memory-1"))?.query).toMatchObject({ expectedVersion: "2" });
  const writes = calls.filter(call => call.method !== "GET" && call.path.startsWith("/api/v1/workspaces/"));
  expect(writes.every(call => call.csrf === "paired-csrf")).toBe(true);
  expect(writes.every(call => call.path.includes("/work/conversation-memory/"))).toBe(true);
});

test("SIMULATED provider outage shows a real unavailable state and blocks recall", async ({ page }) => {
  const { calls } = await mountConversationMemory(page, { provider: "unavailable" });
  await expect(page.getByText("Memory provider unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/memories/query"))).toBe(false);
});

test("SIMULATED read-only session cannot mutate memory or source authorization", async ({ page }) => {
  const { calls } = await mountConversationMemory(page, { readOnly: true });
  await page.getByLabel("Conversation ID", { exact: true }).fill("chat-1");
  await page.getByRole("button", { name: "Load scope", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save memory", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Revoke source", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Grant sharing", exact: true })).toBeDisabled();
  expect(calls.some(call => call.method !== "GET" && call.path.startsWith("/api/v1/workspaces/"))).toBe(false);
});

test("SIMULATED workspace mismatch blocks conversation memory reads and writes", async ({ page }) => {
  const { calls } = await mountConversationMemory(page, { hostWorkspace: "different-workspace" });
  await expect(page.getByRole("alert")).toContainText("Selected workspace does not match");
  expect(calls.some(call => call.method !== "GET" && call.path.startsWith("/api/v1/workspaces/"))).toBe(false);
  expect(calls.some(call => call.path.includes("/work/conversation-memory/"))).toBe(false);
});
