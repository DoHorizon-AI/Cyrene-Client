// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Aether P2 real local acceptance                             │
// │ Role: Exercise Web ingress, Work memory readback, revoke, and re-turn.│
// │ 中文：模块职责：真实验收 Web 入口、记忆回读、撤销与后续轮次。      │
// └─────────────────────────────────────────────────────────────────────┘

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type JsonReadback = { status: number; body: unknown };
type MemoryRecord = { id: string; version: number; kind: string; text: string; sourceMessageIds: string[]; state: string };
type SourceRecord = { id: string; status: string };
type MessageRecord = { id: string; eventId: string; role: string; content: string; occurredAt: number; sourceRefs: Array<{ memoryId: string | null; memoryVersion: number | null; sourceMessageIds: string[] }> };
type TurnAdmission = { conversationId: string; taskId: string; sessionId: string; status: string; eventsUrl: string; statusUrl: string };
type CapturedTurn = { admission: TurnAdmission; body: { conversationId: string; text: string }; idempotencyKey: string; controlToken: string; csrfToken: string };

const workspaceId = "local";
const turnPath = "/api/v1/conversation-assistant/turns";
const workBase = `/api/v1/workspaces/${workspaceId}/work/conversation-memory`;

async function readSameOriginJson(page: Page, path: string): Promise<JsonReadback> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } });
    const body: unknown = await response.json();
    return { status: response.status, body };
  }, path);
}

async function privatePairingCode(): Promise<string | null> {
  const supplied = process.env.CYRENE_AETHER_PAIRING_CODE?.trim();
  if (supplied) return supplied;
  const filePath = process.env.CYRENE_AETHER_PAIRING_CODE_FILE;
  if (!filePath) return null;
  try { return (await readFile(filePath, "utf8")).trim() || null; }
  catch { return null; }
}

async function enterConversationChat(page: Page, conversationId: string): Promise<void> {
  await page.goto("/conversation-chat");
  const pairingCodeInput = page.getByLabel(/One-time pairing code|一次性配对码/).first();
  if (await pairingCodeInput.count()) {
    const pairingCode = await privatePairingCode();
    if (!pairingCode) test.skip(true, "NOT_RUN: a private WSL pairing code is required for this browser context.");
    await pairingCodeInput.fill(pairingCode!);
    await page.getByRole("button", { name: /Connect|连接/ }).click();
  }
  await expect(page.getByLabel(/Conversation ID|对话 ID/)).toBeVisible();
  const readOnly = page.getByText(/Sending a conversation turn requires products\.operate|发送对话轮次需要 products\.operate/);
  if (await readOnly.count()) test.skip(true, "NOT_RUN: the local Web Host session lacks products.operate.");
  await page.getByLabel(/Conversation ID|对话 ID/).fill(conversationId);
}

async function sendTurn(page: Page, message: string): Promise<CapturedTurn> {
  await page.getByLabel(/Message|消息/).fill(message);
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === turnPath);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === turnPath);
  await page.getByRole("button", { name: /Send private message|发送私密消息/ }).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(202);
  const admission = await response.json() as TurnAdmission;
  const requestHeaders = await request.allHeaders();
  const body = request.postDataJSON() as { conversationId: string; text: string };
  expect(body).toMatchObject({ conversationId: admission.conversationId, text: message });
  expect(Boolean(requestHeaders["idempotency-key"])).toBe(true);
  await expect(page.getByText(/Assistant reply|助手回复/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 180_000 });
  return {
    admission,
    body,
    idempotencyKey: requestHeaders["idempotency-key"] ?? "",
    controlToken: requestHeaders["x-studio-control-token"] ?? "",
    csrfToken: requestHeaders["x-csrf-token"] ?? "",
  };
}

async function replaySameTurn(page: Page, turn: CapturedTurn): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async ({ body, idempotencyKey, controlToken, csrfToken }) => {
    const headers = new Headers({ "Content-Type": "application/json", "Idempotency-Key": idempotencyKey });
    if (controlToken) headers.set("X-Studio-Control-Token", controlToken);
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    const response = await fetch("/api/v1/conversation-assistant/turns", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as unknown };
  }, turn);
}

function longSummaryInput(turn: number, marker: string): string {
  const statement = "This private history repeats one durable preference: the user prefers concise replies. Keep the exact verification marker " + marker + " and associate it with that preference. Context item " + turn + ".";
  return Array.from({ length: 8 }, (_, index) => statement + " Additional source context " + index + ".").join(" ")
    + " Reply with one brief acknowledgement.";
}

test("REAL WSL Web turn recalls an attributed memory and revocation removes it from the next turn", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  const conversationId = `aether-real-${randomUUID().replaceAll("-", "")}`;
  const marker = `AETHER${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const userMessage = `For this private acceptance conversation, remember that my reply style preference is concise. Keep the exact verification marker ${marker} with that preference so I can check source-linked recall.`;
  const memoryText = `Private acceptance preference: concise replies, marker ${marker}.`;
  const correctedText = `Corrected private acceptance preference: very concise replies, marker ${marker}.`;

  await enterConversationChat(page, conversationId);
  await sendTurn(page, userMessage);
  await expect(page.getByText(userMessage, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /Open memory controls|打开记忆管理/ }).click();
  await expect(page.getByLabel(/Conversation ID|对话 ID/)).toHaveValue(conversationId);
  if (await page.getByText(/source, memory, and authorization changes require products\.write|修改来源、记忆和授权需要 products\.write/).count()) {
    test.skip(true, "NOT_RUN: the local Web Host session lacks products.write.");
  }
  await page.getByRole("button", { name: /Load scope|读取范围/ }).click();
  await expect(page.getByRole("button", { name: /Search|搜索/ })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: /Read messages|读取消息/ }).click();
  const sourceMessageRow = page.locator(".conversation-memory__messages > li").filter({ hasText: marker });
  await expect(sourceMessageRow).toBeVisible();
  const sourceMessageId = (await sourceMessageRow.locator("small").innerText()).match(/([A-Za-z0-9][A-Za-z0-9_.:-]{0,511})\s*·/)?.[1];
  expect(sourceMessageId).toBeTruthy();
  await sourceMessageRow.getByRole("checkbox", { name: /Use as evidence|作为证据/ }).check();
  await page.getByLabel(/Memory text|记忆文本/).fill(memoryText);
  await page.getByRole("button", { name: /Save memory|保存记忆/ }).click();
  await expect(page.getByText(memoryText, { exact: true })).toBeVisible({ timeout: 60_000 });

  const memoriesPath = `${workBase}/memories?limit=100&conversationId=${encodeURIComponent(conversationId)}&conversationKind=direct`;
  const initialReadback = await readSameOriginJson(page, memoriesPath);
  expect(initialReadback.status).toBe(200);
  const initialItems = (initialReadback.body as { items?: MemoryRecord[] }).items ?? [];
  const createdMemory = initialItems.find((item) => item.text === memoryText);
  expect(createdMemory).toBeDefined();
  expect(createdMemory?.sourceMessageIds).toContain(sourceMessageId);

  await page.getByLabel(/Semantic query|语义查询/).fill(marker);
  await page.getByRole("button", { name: /Search|搜索/ }).click();
  await expect(page.getByText(memoryText, { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  const messagesQuery = new URLSearchParams({ conversationId, conversationKind: "direct", limit: "100" });
  const beforeRecall = await readSameOriginJson(page, `${workBase}/messages?${messagesQuery}`);
  expect(beforeRecall.status).toBe(200);
  const priorAssistantIds = new Set(((beforeRecall.body as { items?: MessageRecord[] }).items ?? []).filter((item) => item.role === "assistant").map((item) => item.id));
  await enterConversationChat(page, conversationId);
  await sendTurn(page, "What reply style did I ask you to remember? Use currently authorized saved preference; if none exists, say none.");
  const recalledMessages = await readSameOriginJson(page, `${workBase}/messages?${messagesQuery}`);
  expect(recalledMessages.status).toBe(200);
  const recalledAssistant = ((recalledMessages.body as { items?: MessageRecord[] }).items ?? [])
    .filter((item) => item.role === "assistant" && !priorAssistantIds.has(item.id))
    .sort((a, b) => b.occurredAt - a.occurredAt)[0];
  expect(recalledAssistant?.sourceRefs.some((ref) => ref.memoryId === createdMemory!.id
    && ref.memoryVersion === createdMemory!.version && ref.sourceMessageIds.includes(sourceMessageId!))).toBe(true);
  await page.getByRole("link", { name: /Open memory controls|打开记忆管理/ }).click();

  const memoryRow = page.locator(".conversation-memory__list > li").filter({ hasText: createdMemory!.id }).last();
  await memoryRow.getByRole("button", { name: /Correct|纠错/ }).click();
  await page.getByLabel(/Corrected text|修正后的文本/).fill(correctedText);
  await page.getByRole("button", { name: /Save correction|保存修正/ }).click();
  await expect(page.locator(".conversation-memory__list > li").filter({ hasText: createdMemory!.id }).last()).toContainText(correctedText);

  const correctedReadback = await readSameOriginJson(page, memoriesPath);
  expect(correctedReadback.status).toBe(200);
  const corrected = ((correctedReadback.body as { items?: MemoryRecord[] }).items ?? []).find((item) => item.id === createdMemory!.id);
  expect(corrected?.version).toBe(createdMemory!.version + 1);

  const sourcesGrid = page.locator(".conversation-memory__grid").nth(1);
  const sourcesPanel = sourcesGrid.locator(".panel").filter({ hasText: /Authorized sources|已授权来源/ });
  const sourceRow = sourcesPanel.locator(".conversation-memory__list > li").filter({ hasText: sourceMessageId! });
  await expect(sourceRow).toContainText("active");
  await sourceRow.getByRole("button", { name: /Revoke source|撤销来源/ }).click();
  await expect(sourceRow).toContainText("revoked", { timeout: 60_000 });

  const sourcesPath = `${workBase}/sources?conversationId=${encodeURIComponent(conversationId)}`;
  const sourcesReadback = await readSameOriginJson(page, sourcesPath);
  expect(sourcesReadback.status).toBe(200);
  const source = ((sourcesReadback.body as { items?: SourceRecord[] }).items ?? []).find((item) => item.id === sourceMessageId);
  expect(source?.status).toBe("revoked");

  await page.getByLabel(/Semantic query|语义查询/).fill(marker);
  await page.getByRole("button", { name: /Search|搜索/ }).click();
  await expect(page.getByText(/No memory matches|没有记忆匹配/)).toBeVisible({ timeout: 60_000 });

  await enterConversationChat(page, conversationId);
  await sendTurn(page, "Use only currently authorized saved memory for my reply style. If no authorized preference remains, say that no preference is available.");
  const messageReadback = await readSameOriginJson(page, `${workBase}/messages?${messagesQuery}`);
  expect(messageReadback.status).toBe(200);
  const messageItems = (messageReadback.body as { items?: MessageRecord[] }).items ?? [];
  const latestAssistant = messageItems.filter((item) => item.role === "assistant").sort((a, b) => a.occurredAt - b.occurredAt).at(-1);
  expect(latestAssistant).toBeDefined();
  expect(latestAssistant?.sourceRefs.some((ref) => ref.memoryId === createdMemory!.id || ref.sourceMessageIds.includes(sourceMessageId!))).toBe(false);
});

test("REAL WSL turns extract a sourced episode, deduplicate an exact retry, and support memory lifecycle", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  const conversationId = "aether-summary-" + randomUUID().replaceAll("-", "");
  const marker = "AETHERSUMMARY" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const query = new URLSearchParams({ conversationId, conversationKind: "direct", limit: "100" });
  const messagesPath = workBase + "/messages?" + query.toString();
  const memoriesPath = workBase + "/memories?limit=100&conversationId=" + encodeURIComponent(conversationId) + "&conversationKind=direct&state=active";

  await enterConversationChat(page, conversationId);
  const firstTurn = await sendTurn(page, longSummaryInput(1, marker));
  const beforeReplay = await readSameOriginJson(page, messagesPath);
  expect(beforeReplay.status).toBe(200);
  const beforeReplayItems = (beforeReplay.body as { items?: MessageRecord[] }).items ?? [];
  const duplicate = await replaySameTurn(page, firstTurn);
  expect(duplicate.status).toBe(202);
  const duplicateAdmission = duplicate.body as TurnAdmission;
  expect(duplicateAdmission.taskId).toBe(firstTurn.admission.taskId);
  const afterReplay = await readSameOriginJson(page, messagesPath);
  expect(afterReplay.status).toBe(200);
  expect(((afterReplay.body as { items?: MessageRecord[] }).items ?? []).map((item) => item.id))
    .toEqual(beforeReplayItems.map((item) => item.id));

  for (let turn = 2; turn <= 8; turn++) {
    await sendTurn(page, longSummaryInput(turn, marker));
  }

  const overviewPath = workBase + "/overview";
  const overview = await readSameOriginJson(page, overviewPath);
  expect(overview.status).toBe(200);
  const overviewBody = overview.body as {
    counts: { messages: number; memories: number; sources: number };
    capabilities: { memoryProvider: string; summarizer: string };
  };
  expect(overviewBody.counts.messages).toBeGreaterThanOrEqual(16);
  expect(overviewBody.capabilities.memoryProvider).toBe("ready");
  expect(overviewBody.capabilities.summarizer).toBe("ready");

  const extractedReadback = await readSameOriginJson(page, memoriesPath);
  expect(extractedReadback.status).toBe(200);
  const extractedItems = (extractedReadback.body as { items?: MemoryRecord[] }).items ?? [];
  const messagesReadback = await readSameOriginJson(page, messagesPath);
  expect(messagesReadback.status).toBe(200);
  const sourceMessages = (messagesReadback.body as { items?: MessageRecord[] }).items ?? [];
  const firstUserMessage = sourceMessages.find((item) => item.role === "user" && item.content.includes(marker));
  expect(firstUserMessage).toBeDefined();
  const sourceMessageId = firstUserMessage!.id;
  const extractedMemory = extractedItems.find((item) =>
    item.kind === "episode" && item.sourceMessageIds.includes(sourceMessageId));
  expect(extractedMemory).toBeDefined();
  expect(extractedMemory?.text.toLowerCase()).toContain("concise");

  const priorAssistantIds = new Set(sourceMessages.filter((item) => item.role === "assistant").map((item) => item.id));
  await page.getByRole("link", { name: /Open memory controls|打开记忆管理/ }).click();
  await page.getByLabel(/Semantic query|语义查询/).fill(marker);
  await page.getByRole("button", { name: /Search|搜索/ }).click();
  await expect(page.getByText(extractedMemory!.text, { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  await enterConversationChat(page, conversationId);
  const recallTurn = await sendTurn(page, "What reply style did I ask you to remember? Use the currently authorized summary.");
  const taskReadback = await readSameOriginJson(page, "/api/v1/navigator/tasks/" + encodeURIComponent(recallTurn.admission.taskId));
  expect(taskReadback.status).toBe(200);
  expect((taskReadback.body as { status?: string }).status).toBe("completed");
  const recalledMessages = await readSameOriginJson(page, messagesPath);
  expect(recalledMessages.status).toBe(200);
  const recalledAssistant = ((recalledMessages.body as { items?: MessageRecord[] }).items ?? [])
    .filter((item) => item.role === "assistant" && !priorAssistantIds.has(item.id))
    .sort((left, right) => right.occurredAt - left.occurredAt)[0];
  expect(recalledAssistant?.sourceRefs.some((reference) => reference.memoryId === extractedMemory!.id
    && reference.memoryVersion === extractedMemory!.version
    && reference.sourceMessageIds.includes(sourceMessageId))).toBe(true);

  await page.getByRole("link", { name: /Open memory controls|打开记忆管理/ }).click();
  const memoryRow = page.locator(".conversation-memory__list > li").filter({ hasText: extractedMemory!.id }).last();
  await memoryRow.getByRole("button", { name: /Correct|纠错/ }).click();
  const correctedText = "Corrected private acceptance preference: very concise replies. Marker " + marker + ".";
  await page.getByLabel(/Corrected text|修正后的文本/).fill(correctedText);
  await page.getByRole("button", { name: /Save correction|保存修正/ }).click();
  await expect(page.locator(".conversation-memory__list > li").filter({ hasText: extractedMemory!.id }).last()).toContainText(correctedText);
  const correctedReadback = await readSameOriginJson(page, memoriesPath);
  expect(correctedReadback.status).toBe(200);
  const correctedMemory = ((correctedReadback.body as { items?: MemoryRecord[] }).items ?? []).find((item) => item.id === extractedMemory!.id);
  expect(correctedMemory?.version).toBe(extractedMemory!.version + 1);
  expect(correctedMemory?.text).toBe(correctedText);

  await page.getByRole("button", { name: /Read messages|读取消息/ }).click();
  const deletionSourceRow = page.locator(".conversation-memory__messages > li").filter({ hasText: sourceMessageId });
  await expect(deletionSourceRow).toBeVisible();
  await deletionSourceRow.getByRole("checkbox", { name: /Use as evidence|作为证据/ }).check();
  const deletionText = "Temporary deletion check for marker " + marker + ".";
  await page.getByLabel(/Memory text|记忆文本/).fill(deletionText);
  await page.getByRole("button", { name: /Save memory|保存记忆/ }).click();
  await expect(page.getByText(/Memory saved with source attribution|记忆及其来源出处已保存/)).toBeVisible();
  const beforeDelete = await readSameOriginJson(page, memoriesPath);
  expect(beforeDelete.status).toBe(200);
  const deletionMemory = ((beforeDelete.body as { items?: MemoryRecord[] }).items ?? []).find((item) => item.text === deletionText);
  expect(deletionMemory).toBeDefined();
  const deletePath = workBase + "/memories/" + encodeURIComponent(deletionMemory!.id);
  const deleteResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === deletePath);
  const deletionRow = page.locator(".conversation-memory__list > li").filter({ hasText: deletionMemory!.id }).last();
  await deletionRow.getByRole("button", { name: /Delete|删除/ }).click();
  const deleteReceipt = await deleteResponse;
  expect(deleteReceipt.status()).toBe(200);
  expect(await deleteReceipt.json()).toMatchObject({ deleted: true });
  const afterDelete = await readSameOriginJson(page, memoriesPath);
  expect(afterDelete.status).toBe(200);
  expect(((afterDelete.body as { items?: MemoryRecord[] }).items ?? []).some((item) => item.id === deletionMemory!.id && item.state === "active")).toBe(false);

  const sourcesGrid = page.locator(".conversation-memory__grid").nth(1);
  const sourcesPanel = sourcesGrid.locator(".panel").filter({ has: page.getByRole("heading", { name: /Authorized sources|已授权来源/ }) });
  const sourceRow = sourcesPanel.locator(".conversation-memory__list > li").filter({ hasText: sourceMessageId });
  await expect(sourceRow).toContainText("active");
  await sourceRow.getByRole("button", { name: /Revoke source|撤销来源/ }).click();
  await expect(sourceRow).toContainText("revoked", { timeout: 60_000 });
  const sourcesReadback = await readSameOriginJson(page, workBase + "/sources?conversationId=" + encodeURIComponent(conversationId));
  expect(sourcesReadback.status).toBe(200);
  const source = ((sourcesReadback.body as { items?: SourceRecord[] }).items ?? []).find((item) => item.id === sourceMessageId);
  expect(source?.status).toBe("revoked");

  await enterConversationChat(page, conversationId);
  const finalTurn = await sendTurn(page, "Use only currently authorized saved memory for my reply style. If none remains, say none.");
  const finalMessages = await readSameOriginJson(page, messagesPath);
  expect(finalMessages.status).toBe(200);
  const finalAssistant = ((finalMessages.body as { items?: MessageRecord[] }).items ?? [])
    .filter((item) => item.role === "assistant")
    .sort((left, right) => left.occurredAt - right.occurredAt)
    .at(-1);
  expect(finalAssistant).toBeDefined();
  expect(finalAssistant?.sourceRefs.some((reference) => reference.memoryId === extractedMemory!.id
    || reference.sourceMessageIds.includes(sourceMessageId))).toBe(false);
  const finalTask = await readSameOriginJson(page, "/api/v1/navigator/tasks/" + encodeURIComponent(finalTurn.admission.taskId));
  expect(finalTask.status).toBe(200);
  expect((finalTask.body as { status?: string }).status).toBe("completed");
});
