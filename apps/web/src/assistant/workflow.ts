import type { Pipeline } from '../../../../packages/pipeline-model';
import { recordSchema, type PipelineRecord } from '../../../../packages/pipeline-control/contracts';
import type { AssistantEvent } from './types';

export function workflowContext(document: Pipeline, base: PipelineRecord | null, selectedId: string | null) {
  const saved = base?.document.id === document.id ? base : null;
  return {
    pipelineId: document.id, name: document.name,
    ...(saved ? { graphRevision: saved.graphRevision, layoutRevision: saved.layoutRevision } : {}),
    hasLocalChanges: !saved || JSON.stringify(document) !== JSON.stringify(saved.document),
    ...(selectedId && document.nodes.some(node => node.id === selectedId) ? { selectedNodeId: selectedId } : {}),
    document: structuredClone(document),
  };
}

const writes = new Set(['pipelines.create', 'pipelines.save', 'pipelines.patch', 'pipelines.layout', 'pipelines.undo', 'pipelines.redo']);
export function changedWorkflow(event: AssistantEvent): PipelineRecord | undefined {
  if (event.type !== 'tool' || event.data.status !== 'completed' || !writes.has(String(event.data.name))) return;
  const result = event.data.detail as { isError?: boolean; structuredContent?: { record?: unknown } } | undefined;
  if (result?.isError) return;
  const record = recordSchema.safeParse(result?.structuredContent?.record);
  return record.success ? record.data : undefined;
}
