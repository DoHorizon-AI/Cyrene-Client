import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const scope = { conversationId: "chat-1", conversationKind: "direct", personaId: "calm", visibility: "private" };
const sourceMessage = {
  id: "message-1", eventId: "event-1", role: "user", content: "The user prefers short, factual answers.", occurredAt: 1_800_000_000_000,
  status: "active", revokedAt: null, sourceRefs: [], scope,
};

async function mountAssistantDomains(page: Page) {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  const calls: Array<{ method: string; path: string; body: unknown; csrf: string | undefined }> = [];
  let persona: Record<string, unknown> | null = null;
  let candidate: Record<string, unknown> | null = null;
  let profile: Record<string, unknown> | null = null;
  let changeset: Record<string, unknown> | null = null;
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postDataJSON() as unknown;
    calls.push({ method, path, body, csrf: request.headers()["x-csrf-token"] });
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session") return reply({ authenticated: true, state: "AUTHENTICATED", sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false });
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "fixture", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path.endsWith("/conversation-memory/overview")) return reply({ authorizationEpoch: 1, counts: { messages: 1, memories: 0, sources: 1 }, capabilities: { memoryProvider: "unavailable", summarizer: "unavailable" } });
    if (path.endsWith("/conversation-memory/messages")) return reply({ items: [sourceMessage], nextCursor: null });
    if (path.endsWith("/conversation-memory/personas") && method === "GET") return reply({ items: persona ? [persona] : [] });
    if (path.endsWith("/conversation-memory/personas") && method === "PUT") {
      const input = body as Record<string, unknown>;
      persona = { ...input, description: input["description"] ?? "", conversationIds: input["conversationIds"] ?? [], version: 1, createdAt: 1000, updatedAt: 1000 };
      return reply({ persona });
    }
    if (path.endsWith("/conversation-memory/profile-candidates") && method === "GET") return reply({ items: candidate ? [candidate] : [] });
    if (path.endsWith("/conversation-memory/profile-candidates") && method === "POST") {
      const input = body as Record<string, unknown>;
      candidate = { id: "candidate-1", ...input, personaId: input["personaId"] ?? null, state: "candidate", version: 1, profileId: null, evidence: { sourceMessageIds: input["sourceMessageIds"], confidence: input["confidence"] }, createdAt: 1000, updatedAt: 1000 };
      return reply({ candidate, duplicate: false });
    }
    if (path.endsWith("/conversation-memory/profile-candidates/candidate-1/activate") && method === "POST") {
      candidate = { ...candidate!, state: "active", version: 2, profileId: "profile-1" };
      profile = { id: "profile-1", candidateId: "candidate-1", conversationId: "chat-1", conversationKind: "direct", subjectKind: "user", personaId: null, category: "preference", text: "The user prefers short, factual answers.", sourceMessageIds: ["message-1"], evidence: { sourceMessageIds: ["message-1"], confidence: 0.9 }, validUntil: null, state: "active", version: 1, previousProfileId: null, createdAt: 1100, updatedAt: 1100 };
      return reply({ profile });
    }
    if (path.endsWith("/conversation-memory/profiles") && method === "GET") return reply({ items: profile?.state === "active" ? [profile] : [] });
    if (path.endsWith("/conversation-memory/profiles/profile-1/rollback") && method === "POST") {
      profile = { ...profile!, state: "rolled_back", version: 2, updatedAt: 1200 };
      return reply({ profile });
    }
    if (path.endsWith("/conversation-memory/graph/changesets") && method === "GET") return reply({ items: changeset ? [changeset] : [] });
    if (path.endsWith("/conversation-memory/graph/proposals") && method === "POST") {
      const input = body as Record<string, unknown>;
      changeset = { id: "graph-change-1", ...input, digest: "b".repeat(64), state: "proposed", version: 1, providerReceipt: null, providerStatus: "unavailable", providerApplied: false, createdAt: 1300, updatedAt: 1300 };
      return reply({ changeset, duplicate: false });
    }
    if (path.endsWith("/conversation-memory/graph/query") && method === "POST") return reply({ code: "GRAPH_PROVIDER_UNAVAILABLE", detail: "Graph query provider is unavailable." }, 503);
    if (path.endsWith("/conversation-memory/graph/changesets/graph-change-1/apply") && method === "POST") {
      changeset = { ...changeset!, state: "projected", version: 2, providerReceipt: { requestDigest: "b".repeat(64), readbackDigest: "b".repeat(64), nodeCount: 1, edgeCount: 0, appliedAt: 1400 }, providerStatus: "applied", providerApplied: true, updatedAt: 1400 };
      return reply({ changeset });
    }
    return reply({ code: "NOT_FOUND", detail: `No fixture route for ${method} ${path}.` }, 404);
  });
  await page.goto("/?fixture=conversation-assistant");
  return { calls };
}

test("SIMULATED browser flow saves a persona, reviews a sourced profile, then records a graph projection", async ({ page }) => {
  const { calls } = await mountAssistantDomains(page);
  page.on("dialog", dialog => dialog.accept());

  await page.getByRole("tab", { name: "Personas & profiles" }).click();
  await page.getByLabel("Conversation ID", { exact: true }).fill("chat-1");
  await page.getByLabel("Persona ID", { exact: true }).fill("calm");
  await page.getByLabel("Name", { exact: true }).fill("Calm");
  await page.getByLabel("Persona prompt", { exact: true }).fill("Keep answers concise.");
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(page.getByText("Persona saved: Calm", { exact: false })).toBeVisible();

  await page.getByLabel("Candidate text", { exact: true }).fill("The user prefers short, factual answers.");
  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save candidate", exact: true }).click();
  await expect(page.getByText("candidate-1", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(page.getByText("profile-1", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Rollback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Profile rolled back");

  await page.getByRole("tab", { name: "Knowledge graph" }).click();
  await page.getByLabel("Conversation ID", { exact: true }).fill("chat-1");
  await page.getByLabel("Query graph", { exact: true }).fill("who is connected?");
  await page.getByRole("button", { name: "Search graph", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Graph query provider is unavailable.");
  await page.getByLabel("Node ID", { exact: true }).fill("person-1");
  await page.getByLabel("Node label", { exact: true }).fill("Person");
  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save proposal", exact: true }).click();
  await expect(page.getByText("graph-change-1", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Apply graph changeset", exact: true }).click();
  await expect(page.getByText("Graph provider applied and readback verified", { exact: false })).toBeVisible();

  expect(calls.some(call => call.method === "PUT" && call.path.endsWith("/personas"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/profile-candidates"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/profile-candidates/candidate-1/activate"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/profiles/profile-1/rollback"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/graph/proposals"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/graph/query"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/graph/changesets/graph-change-1/apply"))).toBe(true);
  const writes = calls.filter(call => call.method !== "GET" && call.path.startsWith("/api/v1/workspaces/"));
  expect(writes.every(call => call.csrf === "paired-csrf")).toBe(true);
});
