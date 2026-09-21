// Upstream core bundle uses the same public types without its bundled example nodes.
declare module "litegraph.js/build/litegraph.core.js" {
  export { LiteGraph, LGraph, LGraphNode, LGraphCanvas } from "litegraph.js";
}
