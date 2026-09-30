import { describe, expect, it } from 'vitest';
import { examplePipeline, nodeSchema } from '../../packages/pipeline-model';
import { rebaseHistory } from '../../apps/web/src/pipelines/history';
import { MemoryStateStore } from '../../packages/control-storage';
import { PipelineControl, emptyPipelineDatabase } from '../../packages/pipeline-control/service';
import { teamDatabase } from '../../packages/team-control/service';

describe('remote history reconciliation', () => {
  it('keeps local undo and redo while retaining independent remote changes', () => {
    const original = examplePipeline(), edited = structuredClone(original), remote = structuredClone(original);
    edited.name = 'Local rename'; remote.name = edited.name;
    remote.nodes.find(n => n.id === 'training')!.config.epochs = 99;
    const history = rebaseHistory([original], edited, remote);
    expect(history).toHaveLength(1); expect(history[0].name).toBe(original.name);
    expect(history[0].nodes.find(n => n.id === 'training')!.config.epochs).toBe(99);
    const redo = rebaseHistory([edited], original, history[0]);
    expect(redo[0]).toEqual(remote);
  });
  it('stops at a conflict and never restores another document or an overwritten layout', () => {
    const before = examplePipeline(), old = structuredClone(before), remote = structuredClone(before);
    old.name = 'Older'; remote.name = 'Remote';
    expect(rebaseHistory([old], before, remote)).toEqual([]);
    remote.id = 'other'; expect(rebaseHistory([old], before, remote)).toEqual([]);
    remote.id = before.id; remote.name = before.name; old.name = before.name;
    old.presentation.nodes.training.x += 10; remote.presentation.nodes.training.x += 20;
    expect(rebaseHistory([old], before, remote)).toEqual([]);
  });
});
it('migrates only the legacy bootstrap owner to instance administrator', () => {
  const member = { id: 'owner', username: 'owner', passwordHash: 'opaque', workspaceIds: ['local'], roles: ['admin'], disabled: false };
  const original = { version: 1, members: [member, { ...member, id: 'delegate', username: 'delegate' }], sessions: [], audit: [] };
  const migrated = teamDatabase.parse(original);
  expect(migrated.members.map(m => m.instanceAdmin)).toEqual([true, false]);
  expect(teamDatabase.parse(migrated)).toEqual(migrated);
});
it('rejects mismatched artifact identity in the graph contract', () => {
  const node = examplePipeline().nodes.find(n => n.type === 'dataset')!;
  node.settingsBinding = { kind: 'dataset-version', resourceId: 'v1', artifact: { uri: `artifact://sha256/${'a'.repeat(64)}`, digest: `sha256:${'b'.repeat(64)}`, size_bytes: 1, kind: 'dataset' } };
  expect(nodeSchema.safeParse(node).success).toBe(false);
  node.settingsBinding.artifact!.digest = `sha256:${'a'.repeat(64)}`;
  expect(nodeSchema.safeParse(node).success).toBe(true);
});
it('replays semantic retries and legacy receipts without consuming more storage', async () => {
  const store = new MemoryStateStore(emptyPipelineDatabase()), control = new PipelineControl(store, { maxReceipts: 1 });
  const actor = { id: 'test', workspaceIds: ['local'], scopes: ['pipelines.write'] };
  const document = examplePipeline();
  const request = { name: 'pipelines.create', input: { workspaceId: 'local', document }, requestId: 'create', idempotencyKey: 'one' };
  const first = await control.execute(request, actor);
  // Simulate an old receipt whose fingerprint used insertion order.
  await store.transact(db => { db.receipts[0].fingerprint = JSON.stringify([request.name, request.input]); });
  for (const node of document.nodes) node.config = Object.fromEntries(Object.entries(node.config).reverse());
  expect(await control.execute(request, actor)).toEqual(first);
  await expect(control.execute({ ...request, idempotencyKey: 'two' }, actor)).rejects.toMatchObject({ code: 'STORE_LIMIT' });
  expect((await store.read()).receipts).toHaveLength(1);
});
it('rolls back a write that exceeds the state size limit', async () => {
  const store = new MemoryStateStore(emptyPipelineDatabase()), control = new PipelineControl(store, { maxBytes: 100 });
  await expect(control.execute({ name: 'pipelines.create', input: { workspaceId: 'local', document: examplePipeline() }, requestId: 'r', idempotencyKey: 'k' }, { id: 'test', workspaceIds: ['local'], scopes: ['pipelines.write'] })).rejects.toMatchObject({ code: 'STORE_LIMIT' });
  expect(await store.read()).toEqual(emptyPipelineDatabase());
});
