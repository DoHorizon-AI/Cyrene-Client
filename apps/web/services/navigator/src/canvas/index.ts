// -----------------------------------------------------------------------------
// Module: src/canvas/index.ts
// Role: Canvas & Flow Engine public exports for Cyrene Navigator & Client.
// -----------------------------------------------------------------------------

export { FlowPage, serviceRouteForNode } from "./FlowPage";
export { GraphCanvas, type GraphHandle } from "./GraphCanvas";
export {
  pipelineStore,
  usePipelineStore,
  saveOrUpdateNode,
  getPipeline,
  setPipeline,
  removeNode,
  resetToExample,
  clearPipeline,
  subscribe,
} from "./pipeline-store";
export {
  registerNodes,
  editorNodes,
  appendNode,
  loadGraph,
  snapshotGraph,
  ClientNode,
  type EditorGraph,
} from "./adapter";
