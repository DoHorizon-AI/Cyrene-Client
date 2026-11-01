// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Conversation operations browser tests                       │
// │ Role: Exercise scoped job, research, focus, and import workflows.   │
// │ 中文：模块职责：验证任务、研究、关注项和导入的浏览器交互。            │
// └─────────────────────────────────────────────────────────────────────┘

import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const sourceMessage = {
  id: "message-1", eventId: "event-1", role: "user", content: "The user prefers concise answers.", occurredAt: 1_800_000_000_000,
  status: "active", revokedAt: null, sourceRefs: [], scope: { conversationId: "chat-1", conversationKind: "direct", personaId: null, visibility: "private" },
};
const backupBytes = "{}";
const backupDigest = createHash("sha256").update(backupBytes).digest("hex");

async function mountOperations(page: Page) {
  const entry = `/@fs/${resolve("tests/fixtures/product-state.tsx").replaceAll("\\", "/")}`;
  await page.route("**/src/main.tsx", route => route.fulfill({ contentType: "text/javascript", body: `import ${JSON.stringify(entry)};` }));
  const calls: Array<{ method: string; path: string; body: unknown; csrf?: string }> = [];
  let job: Record<string, unknown> | null = null;
  let note: Record<string, unknown> | null = null;
  let skill: Record<string, unknown> | null = null;
  let watch: Record<string, unknown> | null = null;
  let focus: Record<string, unknown> | null = null;
  let reviewEvent: Record<string, unknown> | null = null;
  let importApplied = false;
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postDataJSON() as unknown;
    calls.push({ method, path, body, csrf: request.headers()["x-csrf-token"] });
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === "/api/v1/auth/session") return reply({ authenticated: true, state: "AUTHENTICATED", sessionId: "paired-session", expiresAt: null, refreshExpiresAt: null, refreshable: true, csrfToken: "paired-csrf", refreshed: false });
    if (path === "/api/v1/system/status") return reply({ service: "Navigator", status: "OK", version: "fixture", workspaceId: "local", authenticated: true, proxyPrefixes: [], credentials: { active: 0, revoked: 0 }, observedAt: new Date().toISOString() });
    if (path.endsWith("/conversation-memory/maintenance/jobs") && method === "GET") return reply({ items: job ? [job] : [] });
    if (path.endsWith("/conversation-memory/maintenance/jobs") && method === "POST") {
      const input = body as Record<string, unknown>;
      job = { id: "job-1", taskId: "task-1", ...input, conversationId: input["conversationId"] ?? null, conversationKind: input["conversationKind"] ?? null, personaId: null, state: "queued", cursor: null, processedCount: 0, checkpointDigest: null, details: {}, version: 1, queuedVersion: 1, createdAt: 1000, updatedAt: 1000 };
      return reply({ job, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/maintenance/jobs/job-1/cancel") && method === "POST") { job = { ...job!, state: "cancelled", version: 2, updatedAt: 2000 }; return reply({ job }); }
    if (path.endsWith("/conversation-memory/maintenance/jobs/job-1")) return reply(job);
    if (path.endsWith("/conversation-memory/messages")) return reply({ items: [sourceMessage], nextCursor: null });
    if (path.endsWith("/conversation-memory/research/notes") && method === "GET") return reply({ items: note ? [note] : [] });
    if (path.endsWith("/conversation-memory/research/notes") && method === "POST") {
      const input = body as Record<string, unknown>;
      note = { id: "note-1", ...input, sourceRefs: [{ memoryId: null, memoryVersion: null, sourceMessageIds: input["sourceRefs"] }], personaId: null, revision: 1, createdAt: 2100 };
      return reply({ note, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/research/skills") && method === "GET") return reply({ items: skill ? [skill] : [] });
    if (path.endsWith("/conversation-memory/research/skills") && method === "POST") {
      const input = body as Record<string, unknown>;
      skill = { id: "skill-1", ...input, sourceRefs: [{ memoryId: null, memoryVersion: null, sourceMessageIds: input["sourceRefs"] }], operationReceiptId: input["operationReceiptId"], independentReadReceiptId: input["independentReadReceiptId"], conversationKind: "direct", personaId: null, verified: true, verifiedBy: "actor-1", verifiedAt: 2150, revision: 1, createdAt: 2150 };
      return reply({ skill, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/watches") && method === "GET") return reply({ items: watch ? [watch] : [] });
    if (path.endsWith("/conversation-memory/watches") && method === "POST") {
      const input = body as Record<string, unknown>;
      watch = { id: "watch-1", ...input, sourceRefs: [{ memoryId: null, memoryVersion: null, sourceMessageIds: input["sourceRefs"] }], personaId: null, nextCheckAt: input["nextCheckAt"] ?? null, state: "active", version: 1, createdAt: 2200, updatedAt: 2200 };
      return reply({ watch, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/watches/watch-1/cancel")) { watch = { ...watch!, state: "cancelled", version: 2, updatedAt: 2300 }; return reply({ watch }); }
    if (path.endsWith("/conversation-memory/focus-items") && method === "GET") return reply({ items: focus ? [focus] : [] });
    if (path.endsWith("/conversation-memory/focus-items") && method === "POST") {
      const input = body as Record<string, unknown>;
      focus = { id: "focus-1", ...input, sourceRefs: [{ memoryId: null, memoryVersion: null, sourceMessageIds: input["sourceRefs"] }], personaId: null, dueAt: input["dueAt"] ?? null, condition: input["condition"] ?? null, state: input["kind"] === "wait" ? "waiting" : "open", version: 1, createdAt: 2400, updatedAt: 2400 };
      return reply({ item: focus, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/focus-items/focus-1/transition")) { focus = { ...focus!, state: (body as Record<string, unknown>)["state"], version: 2, updatedAt: 2500 }; return reply({ item: focus }); }
    if (path.endsWith("/conversation-memory/policies/active-behavior")) return reply({ policy: { conversationId: "chat-1", enabled: false, quietHours: { timeZone: "UTC", start: "22:00", end: "08:00" }, cooldownSeconds: 900, allowGroupInterjections: false, followupEnabled: false, version: 0 } });
    if (path.endsWith("/conversation-memory/review-events") && method === "GET") return reply({ items: reviewEvent ? [reviewEvent] : [] });
    if (path.endsWith("/conversation-memory/review-events") && method === "POST") {
      const input = body as Record<string, unknown>;
      reviewEvent = { id: "review-1", ...input, sourceRefs: [{ memoryId: null, memoryVersion: null, sourceMessageIds: input["sourceRefs"] }], personaId: null, decision: input["decision"] ?? null, createdAt: 2600 };
      return reply({ event: reviewEvent, duplicate: false }, 201);
    }
    if (path.endsWith("/conversation-memory/backups") && method === "POST") return reply({ attachment: { id: backupDigest, workspaceId: "local", sha256: backupDigest, name: "actor-backup.json", mediaType: "application/json", size: backupBytes.length, createdAt: 2700 }, downloadPath: `/api/v1/workspaces/local/work/conversation-memory/backups/attachments/${backupDigest}` });
    if (path.endsWith(`/conversation-memory/backups/attachments/${backupDigest}`) && method === "GET") return route.fulfill({ status: 200, body: backupBytes, headers: { "Content-Type": "application/json", "X-Content-SHA256": backupDigest } });
    if (path.endsWith("/conversation-memory/imports/preview")) return reply({ recordCount: 1, acceptedCount: 1, quarantinedCount: 0, digest: "f".repeat(64) });
    if (path.endsWith("/conversation-memory/imports") && method === "POST") { importApplied = true; return reply({ batchId: (body as Record<string, unknown>)["batchId"], importedCount: 1, quarantinedCount: 0, digest: "f".repeat(64) }, 201); }
    if (path.endsWith("/conversation-memory/imports/aether-batch-1/rollback")) return reply({ batchId: "aether-batch-1", rolledBack: importApplied, quarantinedCount: 0 });
    return reply({ code: "NOT_FOUND", detail: `No fixture route for ${method} ${path}.` }, 404);
  });
  await page.goto("/?fixture=conversation-assistant");
  return { calls };
}

test("SIMULATED browser flow scopes maintenance, sources, lifecycle, and import receipts", async ({ page }) => {
  const { calls } = await mountOperations(page);
  page.on("dialog", dialog => dialog.accept());

  await page.getByRole("tab", { name: "Operations & recovery" }).click();
  await page.getByRole("tab", { name: "Maintenance & Dream" }).click();
  await page.getByLabel("Conversation ID (optional)").fill("chat-1");
  await page.getByRole("button", { name: "Queue job" }).click();
  await expect(page.getByRole("status")).toContainText("Maintenance job record queued.");
  await page.getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByRole("status")).toContainText("Maintenance job cancelled.");

  await page.getByRole("tab", { name: "Research & watches" }).click();
  await page.getByLabel("Title", { exact: true }).first().fill("Conversation summary");
  await page.getByLabel("Content", { exact: true }).fill("The user prefers concise answers.");
  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Research note saved", { exact: false })).toBeVisible();
  await expect(page.getByText("Conversation summary · rev 1")).toBeVisible();

  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByLabel("Skill name").fill("Concise response guide");
  await page.getByLabel("Skill content").fill("Keep answers concise and factual.");
  await page.getByLabel("Verification operation receipt ID").fill("verify-receipt-1");
  await page.getByLabel("Independent readback receipt ID").fill("readback-receipt-1");
  await page.getByRole("button", { name: "Save verified skill" }).click();
  await expect(page.getByText("Verified skill saved: Concise response guide")).toBeVisible();
  await expect(page.getByText("Concise response guide · rev 1")).toBeVisible();

  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByLabel("Title", { exact: true }).last().fill("Follow up");
  await page.getByLabel("Condition to watch for").fill("When the next project update arrives");
  await page.getByLabel("Next check at (optional)").fill("2030-01-02T09:00");
  await page.getByRole("button", { name: "Save watch" }).click();
  await expect(page.getByText("Follow up · active")).toBeVisible();
  await page.getByRole("button", { name: "Stop watch" }).click();
  await expect(page.getByText("Follow up · cancelled")).toBeVisible();

  await page.getByRole("tab", { name: "Focus & handoffs" }).click();
  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByRole("textbox", { name: "Summary", exact: true }).fill("Send the proposal tomorrow");
  await page.getByRole("button", { name: "Save focus item" }).click();
  await expect(page.getByText("commitment · open · v1")).toBeVisible();
  await page.getByRole("button", { name: "Wait", exact: true }).click();
  await expect(page.getByText("commitment · waiting · v2")).toBeVisible();

  await page.getByRole("tab", { name: "Review & import" }).click();
  await page.getByRole("button", { name: "Create backup" }).click();
  await expect(page.getByText(backupDigest)).toBeVisible();
  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup attachment" }).click();
  expect((await downloadWait).suggestedFilename()).toBe("actor-backup.json");
  await page.getByLabel("Conversation ID", { exact: true }).fill("chat-1");
  await page.getByRole("button", { name: "Load review evidence" }).click();
  await page.locator(".conversation-assistant__source-picker").getByRole("checkbox").check();
  await page.getByLabel("Review summary").fill("Confirmed the preference from this conversation.");
  await page.getByRole("button", { name: "Save review event" }).click();
  await expect(page.getByText("Review event recorded", { exact: false })).toBeVisible();
  await expect(page.getByText("reviewed · Confirmed the preference from this conversation.")).toBeVisible();
  await page.getByRole("textbox", { name: "Batch ID", exact: true }).fill("aether-batch-1");
  await page.getByLabel("Import records JSON").fill(JSON.stringify([{ recordId: "import-1", kind: "fact", conversationId: "chat-1", conversationKind: "direct", text: "The user prefers concise answers.", sourceRefs: ["message-1"], visibility: "private" }]));
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText("Dry-run complete. No imported records were written.")).toBeVisible();
  await expect(page.getByText("f".repeat(64))).toBeVisible();
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.getByText("Import batch applied: aether-batch-1")).toBeVisible();
  await page.getByRole("button", { name: "Rollback import" }).click();
  await expect(page.getByText("Import batch rolled back.")).toBeVisible();

  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/maintenance/jobs") && (call.body as Record<string, unknown>)["conversationKind"] === "direct")).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/research/notes"))).toBe(true);
  expect(calls.find(call => call.method === "POST" && call.path.endsWith("/research/skills"))?.body).toMatchObject({ operationReceiptId: "verify-receipt-1", independentReadReceiptId: "readback-receipt-1" });
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/watches/watch-1/cancel"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/focus-items/focus-1/transition"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/imports/preview"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/review-events"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/imports"))).toBe(true);
  expect(calls.some(call => call.method === "POST" && call.path.endsWith("/imports/aether-batch-1/rollback"))).toBe(true);
  expect(calls.filter(call => call.method !== "GET").every(call => call.csrf === "paired-csrf")).toBe(true);
});
