// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-domain API tests                     │
// │ Role: Verify owner-scoped profile and graph routes and DTO parsing.  │
// │ 中文：模块职责：验证画像和图谱 Work 路径及 DTO 解析。                  │
// └─────────────────────────────────────────────────────────────────────┘

import { describe, expect, it } from "vitest";
import { NavigatorApi } from "../api";

const persona = { id: "calm", name: "Calm", description: "", prompt: "Be concise", enabled: true, conversationIds: ["chat-1"], version: 1, createdAt: 1000, updatedAt: 1000 };
const candidate = {
  id: "candidate-1", idempotencyKey: "candidate-key", conversationId: "chat-1", conversationKind: "direct", subjectKind: "user", personaId: null,
  category: "preference", text: "Prefers concise answers.", sourceMessageIds: ["message-1"], confidence: 0.9, validUntil: null,
  state: "candidate", version: 1, profileId: null, evidence: { sourceMessageIds: ["message-1"], confidence: 0.9 }, createdAt: 1000, updatedAt: 1000,
};
const profile = {
  id: "profile-1", candidateId: "candidate-1", conversationId: "chat-1", conversationKind: "direct", subjectKind: "user", personaId: null,
  category: "preference", text: "Prefers concise answers.", sourceMessageIds: ["message-1"], evidence: candidate.evidence,
  validUntil: null, state: "active", version: 1, previousProfileId: null, createdAt: 1000, updatedAt: 1000,
};
const changeset = {
  id: "changeset-1", idempotencyKey: "graph-key", conversationId: "chat-1", conversationKind: "direct", personaId: null, nodes: [{ id: "person-1", label: "Person", sourceMessageIds: ["message-1"] }],
  edges: [], digest: "b".repeat(64), state: "proposed", version: 1, providerReceipt: null, providerStatus: "unavailable", providerApplied: false, createdAt: 1000, updatedAt: 1000,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("conversation profile and graph Work API", () => {
  it("reads and CAS-updates an actor-owned conversation persona binding", async () => {
    const binding = { conversationId: "chat-1", conversationKind: "direct", personaId: "calm", version: 2, createdAt: 1000, updatedAt: 2000 };
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (path.includes("/conversation-memory/personas/binding?") && method === "GET") return response({ binding, availablePersonaIds: ["calm"] });
      if (path.endsWith("/conversation-memory/personas/binding") && method === "PUT") return response({ binding: { ...binding, personaId: null, version: 3, updatedAt: 3000 }, duplicate: false });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const view = await api.getConversationPersonaBinding("workspace-1", { conversationId: "chat-1", conversationKind: "direct" });
    expect(view.binding?.personaId).toBe("calm");
    expect(view.availablePersonaIds).toEqual(["calm"]);
    const receipt = await api.putConversationPersonaBinding("workspace-1", {
      conversationId: "chat-1", conversationKind: "direct", personaId: null, expectedVersion: 2,
    });
    expect(receipt.binding?.personaId).toBeNull();
    expect(receipt.duplicate).toBe(false);
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      conversationId: "chat-1", conversationKind: "direct", personaId: null, expectedVersion: 2,
    });
    expect(calls.find((call) => call.method === "PUT")?.path).toBe("/api/v1/workspaces/workspace-1/work/conversation-memory/personas/binding");
  });

  it("saves personas and reviews sourced profile candidates with expected versions", async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, body });
      if (path.includes("/conversation-memory/personas?") && method === "GET") return response({ items: [persona] });
      if (path.endsWith("/conversation-memory/personas") && method === "PUT") return response({ persona });
      if (path.endsWith("/conversation-memory/profile-candidates") && method === "POST") return response({ candidate });
      if (path.includes("/conversation-memory/profile-candidates?") && method === "GET") return response({ items: [candidate] });
      if (path.includes("/conversation-memory/profiles?") && method === "GET") return response({ items: [profile] });
      if (path.endsWith("/conversation-memory/profile-candidates/candidate-1/activate")) return response({ profile });
      if (path.endsWith("/conversation-memory/profiles/profile-1/rollback")) return response({ profile: { ...profile, state: "rolled_back", version: 2 } });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    expect((await api.getConversationPersonas("workspace-1", "chat-1"))[0]?.id).toBe("calm");
    expect((await api.putConversationPersona("workspace-1", persona)).version).toBe(1);
    expect((await api.createProfileCandidate("workspace-1", {
      idempotencyKey: "candidate-key", conversationId: "chat-1", conversationKind: "direct", subjectKind: "user", category: "preference",
      text: "Prefers concise answers.", sourceMessageIds: ["message-1"], confidence: 0.9,
    })).state).toBe("candidate");
    expect((await api.listProfileCandidates("workspace-1", { state: "candidate" }))[0]?.version).toBe(1);
    expect((await api.listConversationProfiles("workspace-1", { conversationId: "chat-1", state: "active" }))[0]?.id).toBe("profile-1");
    expect((await api.activateProfileCandidate("workspace-1", "candidate-1", 1)).state).toBe("active");
    expect((await api.rollbackConversationProfile("workspace-1", "profile-1", 1)).state).toBe("rolled_back");
    expect(calls.find((call) => call.method === "POST" && call.path.endsWith("/activate"))?.body).toEqual({ expectedVersion: 1 });
    expect(calls.find((call) => call.method === "POST" && call.path.endsWith("/rollback"))?.body).toEqual({ expectedVersion: 1 });
  });

  it("keeps graph proposal application distinct from provider execution", async () => {
    const calls: string[] = [];
    const api = new NavigatorApi(async (input, init) => {
      const path = String(input), method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${path}`);
      if (path.endsWith("/conversation-memory/graph/proposals")) return response({ changeset });
      if (path.includes("/conversation-memory/graph/changesets?")) return response({ items: [changeset] });
      if (path.endsWith("/conversation-memory/graph/changesets/changeset-1/apply")) return response({ changeset: { ...changeset, state: "projected", version: 2, providerReceipt: { requestDigest: changeset.digest, readbackDigest: changeset.digest, nodeCount: 1, edgeCount: 0, appliedAt: 2000 }, providerStatus: "applied", providerApplied: true } });
      if (path.endsWith("/conversation-memory/graph/query")) return response({ code: "GRAPH_PROVIDER_UNAVAILABLE", detail: "No graph query provider is configured." }, 503);
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const proposed = await api.createGraphProposal("workspace-1", {
      idempotencyKey: "graph-key", conversationId: "chat-1", conversationKind: "direct", nodes: changeset.nodes, edges: [],
    });
    expect(proposed.providerApplied).toBe(false);
    expect((await api.listGraphChangesets("workspace-1", "proposed"))[0]?.state).toBe("proposed");
    const projected = await api.applyGraphChangeset("workspace-1", "changeset-1", 1);
    expect(projected.state).toBe("projected");
    expect(projected.providerApplied).toBe(true);
    await expect(api.queryConversationGraph("workspace-1", { conversationId: "chat-1", conversationKind: "direct", query: "who knows whom?" }))
      .rejects.toMatchObject({ code: "GRAPH_PROVIDER_UNAVAILABLE", status: 503 });
    expect(calls.some((call) => call.startsWith("POST /api/v1/workspaces/workspace-1/work/conversation-memory/graph/query"))).toBe(true);
  });
});
