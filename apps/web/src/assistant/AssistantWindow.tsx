import { lazy, Suspense, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Pipeline } from "../../../../packages/pipeline-model";
import type { PipelineRecord } from "../../../../packages/pipeline-control/contracts";
import { useTeamIdentity } from "../team/TeamGate";
import "./assistant.css";

const Chat = lazy(() => import("./Chat"));

export interface AssistantWindowProps {
  document: Pipeline; serverBase: PipelineRecord | null; selectedId: string | null;
  visible: boolean; expanded: boolean; dock: RefObject<HTMLDivElement | null>; center: RefObject<HTMLDivElement | null>;
  toolsRequest?: number;
  onDock(): void; onOpenWorkflow(id: string): Promise<void>; onNotice(message: string): void; onMonitor(): void;
}

export function AssistantWindow(props: AssistantWindowProps) {
  const { actorId, workspaceId } = useTeamIdentity();
  const [host] = useState(() => { const node = document.createElement("div"); node.className = "assistant-portal"; return node; });
  useLayoutEffect(() => {
    (props.expanded ? props.center : props.dock).current?.appendChild(host);
    host.hidden = !props.visible;
    return () => host.remove();
  }, [host, props.expanded, props.visible, props.center, props.dock]);
  return createPortal(<Suspense fallback={<p>AI Assistant…</p>}><Chat key={`${actorId}:${workspaceId}`} {...props} /></Suspense>, host);
}
