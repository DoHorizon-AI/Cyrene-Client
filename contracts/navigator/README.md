# Navigator Work contract snapshot / Navigator Work 契约快照

Navigator's canonical machine-readable contract for Client's durable Work API is
`contracts/product/v1/work.openapi.json`, pinned by `source.json` to commit
`2eea41df68099012aa093b1f40d22445a4396abf`. That exact Navigator commit does not publish
`executor.openapi.json`; the Client does not treat an older executor snapshot as current
authority. Generated `WorkSchemas` come only from the pinned Work OpenAPI.

Harness executor transport shapes are handwritten in the Client and grounded in
Navigator's `harness/src/executor.ts` and `harness/src/work-state-client.ts` at the same
source commit. They are not represented as generated OpenAPI types.

`npm run contracts:navigator:check` verifies the snapshot digest against `source.json`
and confirms generated types match the snapshot without a Navigator checkout.

To update after a Navigator contract change:

```powershell
# Fetch and review the canonical Navigator develop ref before updating the pin.
git -C ../Cyrene-Services/Cyrene-Navigator fetch origin
# Update source.json to the reviewed exact Navigator develop SHA.
$env:CYRENE_NAVIGATOR_DIR = 'C:/path/to/Cyrene-Navigator'
npm run contracts:navigator
npm run contracts:navigator:check
npm run build
```

The generator reads the exact pinned Git object with `git show`; it never reads a mutable
Navigator working-tree file. It also requires the pin to be reachable from fresh
`origin/develop`. Commit `source.json`, `work.openapi.json`, and
`apps/web/services/navigator/src/generated/contracts.ts` together. The snapshot uses LF
newlines so Windows and Linux produce the same bytes.

`WorkSchemas` covers durable tasks, approvals, inputs, memory, attachments, connectors,
and notifications. The browser proxy applies its own permission and workspace checks in
addition to Navigator source validation.

---
<!-- Chinese Translation / 中文翻译 -->

Navigator 当前供 Client 消费的持久 Work API 机器可读契约为
`contracts/product/v1/work.openapi.json`，准确来源固定在 `source.json` 中的
`2eea41df68099012aa093b1f40d22445a4396abf`。该提交没有发布 `executor.openapi.json`，
因此 Client 不会把旧 executor 快照当作当前权威。生成的 `WorkSchemas` 只来自固定的
Work OpenAPI。

Harness executor 的 HTTP 传输类型由 Client 手工声明，并根据同一 Navigator 提交中的
`harness/src/executor.ts` 与 `harness/src/work-state-client.ts` 校验；这些不是生成的
OpenAPI 类型。更新前先 fetch 并审查准确的 Navigator develop SHA，再运行生成器。
