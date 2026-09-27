import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PipelineControls } from "../../apps/web/src/pipelines/PipelineControls";
import { pipelineClient } from "../../apps/web/src/pipelines/client";
import { examplePipeline } from "../../packages/pipeline-model";
import type { PipelineRecord } from "../../packages/pipeline-control/contracts";

declare global {
  interface Window { pipelineLifecycle: { callbacks: string[]; completed: number } }
}
window.pipelineLifecycle = { callbacks: [], completed: 0 };
const execute = pipelineClient.execute.bind(pipelineClient);
pipelineClient.execute = (async (...args: Parameters<typeof execute>) => {
  try { return await execute(...args); }
  finally { setTimeout(() => { window.pipelineLifecycle.completed++; }, 0); }
}) as typeof pipelineClient.execute;

function Harness() {
  const [open, setOpen] = useState(true);
  const [base, setBase] = useState<PipelineRecord | null>(null);
  const [document] = useState(() => ({ ...examplePipeline(), id: `lifecycle-${crypto.randomUUID()}` }));
  const record = (name: string) => { window.pipelineLifecycle.callbacks.push(name); };
  return <><button onClick={() => setOpen(false)}>关闭工作台</button>{open && <PipelineControls
    document={document} serverBase={base} onServerBase={setBase} selectedId={null} disabled={false} canUndo={false} canRedo={false}
    onApply={() => record("apply")} onLoad={() => record("load")}
    onNotice={() => record("notice")} onUndo={() => record("undo")} onRedo={() => record("redo")}
  />}</>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
