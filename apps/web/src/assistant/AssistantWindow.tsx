import { lazy, Suspense, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Pipeline } from '../../../../packages/pipeline-model';
import type { PipelineRecord } from '../../../../packages/pipeline-control/contracts';
import { useTeamIdentity } from '../team/TeamGate';
import './assistant.css';
const Chat = lazy(() => import('./Chat'));
export function AssistantWindow({ dock, center, expanded, visible, ...props }: {
  dock: RefObject<HTMLDivElement | null>; center: RefObject<HTMLDivElement | null>; expanded: boolean; visible: boolean;
  document: Pipeline; serverBase: PipelineRecord | null; selectedId: string | null; onOpenWorkflow(id: string): Promise<void>; onNotice(message: string): void; onMonitor(): void; onDock(): void;
}) {
  const { actorId, workspaceId } = useTeamIdentity();
  const [host] = useState(() => { const node = document.createElement('div'); node.className = 'assistant-portal'; return node; });
  useLayoutEffect(() => { (expanded ? center : dock).current?.appendChild(host); return () => host.remove(); }, [expanded, host, center, dock]);
  useLayoutEffect(() => { host.hidden = !visible; }, [host, visible]);
  return createPortal(<Suspense fallback={<p>AI Assistant…</p>}><Chat key={`${actorId}:${workspaceId}`} {...props} expanded={expanded} visible={visible} /></Suspense>, host);
}
