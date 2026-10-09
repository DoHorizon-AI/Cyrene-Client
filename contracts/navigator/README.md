# Navigator contract snapshots

The authoritative sources are Navigator's `contracts/product/v1/executor.openapi.json`
and `work.openapi.json`. These snapshots allow Client to build and verify its generated
types without a Navigator checkout or a running service. They contain schemas and
operation descriptions, never credentials or user records.

To update after a Navigator contract change:

```powershell
# Standard layout uses ../Cyrene-Services/Cyrene-Navigator automatically.
$env:CYRENE_NAVIGATOR_DIR = 'C:/path/to/Cyrene-Navigator'
npm run contracts:navigator
npm run contracts:navigator:check
npm run build
```

Commit both snapshots and `apps/web/services/navigator/src/generated/contracts.ts`
together. The generated file records each source's SHA-256 using LF newlines, so
Windows and Linux produce the same result. `npm run check` detects stale generated
types against the committed snapshots; updating from Navigator is an explicit step.

`ExecutorSchemas` covers executor tasks, personal runtimes, assistant providers and
stream events. `WorkSchemas` covers durable tasks, approvals, inputs and attachments.
The browser proxy applies its own permission and workspace checks in addition to
the source service's validation.
