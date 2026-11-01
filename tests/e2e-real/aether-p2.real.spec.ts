// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Aether P2 real local acceptance                             │
// │ Role: Exercise Web ingress, Work memory readback, revoke, and re-turn.│
// │ 中文：模块职责：真实验收 Web 入口、记忆回读、撤销与后续轮次。      │
// └─────────────────────────────────────────────────────────────────────┘

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type JsonReadback = { status: number; body: unknown };
type MemoryRecord = { id: string; version: number; text: string; sourceMessageIds: string[]; state: string };
type SourceRecord = { id: string; status: string };
type MessageRecord = { id: string; eventId: string; role: string; occurredAt: number; sourceRefs: Array<{ memoryId: string | null; memoryVersion: number | null; sourceMessageIds: string[] }> };

const workspaceId = "local";
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

async function sendTurn(page: Page, message: string): Promise<void> {
  await page.getByLabel(/Message|消息/).fill(message);
  await page.getByRole("button", { name: /Send private message|发送私密消息/ }).click();
  await expect(page.getByText(/Assistant reply|助手回复/)).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 180_000 });
}

test("REAL WSL Web turn persists an attributed memory and revocation removes it from the next turn", async ({ page }) => {
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

  const memoryRow = page.locator(".conversation-memory__list > li").filter({ hasText: createdMemory!.id }).last();
  await memoryRow.getByRole("button", { name: /Correct|纠错/ }).click();
  await page.getByLabel(/Corrected text|修正后的文本/).fill(correctedText);
  await page.getByRole("button", { name: /Save correction|保存修正/ }).click();
  await expect(page.locator(".conversation-memory__list > li").filter({ hasText: createdMemory!.id }).last()).toContainText(correctedText);

  const correctedReadback = await readSameOriginJson(page, memoriesPath);
  expect(correctedReadback.status).toBe(200);
  const corrected = ((correctedReadback.body as { items?: MemoryRecord[] }).items ?? []).find((item) => item.id === createdMemory!.id);
  expect(corrected?.version).toBe(createdMemory!.version + 1);

  const sourcesGrid = page.locator(".conversation-memory__grid").last();
  const sourcesPanel = sourcesGrid.locator(".panel").filter({ has: page.getByRole("heading", { name: /Authorized sources|已授权来源/ }) });
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
  const messagesQuery = new URLSearchParams({ conversationId, conversationKind: "direct", limit: "100" });
  const messageReadback = await readSameOriginJson(page, `${workBase}/messages?${messagesQuery}`);
  expect(messageReadback.status).toBe(200);
  const messageItems = (messageReadback.body as { items?: MessageRecord[] }).items ?? [];
  const latestAssistant = messageItems.filter((item) => item.role === "assistant").sort((a, b) => a.occurredAt - b.occurredAt).at(-1);
  expect(latestAssistant).toBeDefined();
  expect(latestAssistant?.sourceRefs.some((ref) => ref.memoryId === createdMemory!.id || ref.sourceMessageIds.includes(sourceMessageId!))).toBe(false);
});
