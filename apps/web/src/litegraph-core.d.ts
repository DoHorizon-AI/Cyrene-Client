// Upstream core bundle uses the same public types without its bundled example nodes.
// 上游 core 包含相同的公共类型，但不包含其示例节点。
declare module "litegraph.js/build/litegraph.core.js" {
  export { LiteGraph, LGraph, LGraphNode, LGraphCanvas } from "litegraph.js";
}
