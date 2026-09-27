// -----------------------------------------------------------------------------
// Module: src/model/pipeline-store.ts
// Role: Global lightweight pipeline store and event bus for service workspace save-as-node operations.
// -----------------------------------------------------------------------------
// 中文：模块职责：提供全局轻量级流水线状态存储与事件总线，支撑各服务工作台“完成修改 · 保存为节点”。

import { definitions } from "./catalog";

export const PIPELINE_STORAGE_KEY = "cyrene.client.pipeline.v1";

export interface PipelineNodeData {
  id: string;
  type: string;
  typeVersion: "1";
  label: string;
  config: Record<string, string | number>;
  settingsBinding?: {
    kind: "dataset-version" | "model-import" | "training-draft" | "evaluation-suite" | "serving-binding" | "navigator-session" | "server-registration";
    resourceId: string;
    workspaceId?: string;
  };
}

export interface PipelineEdgeData {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

export interface PipelineData {
  schemaVersion: "cyrene.pipeline.prototype.v1";
  id: string;
  name: string;
  nodes: PipelineNodeData[];
  edges: PipelineEdgeData[];
  presentation: {
    nodes: Record<string, { x: number; y: number; pinned?: boolean }>;
  };
}

export interface PipelineStoreEvent {
  action: "saveOrUpdateNode" | "reset" | "load";
  nodeType?: string;
  node?: PipelineNodeData;
  label?: string;
  config?: Record<string, string | number>;
}

type Listener = (event: PipelineStoreEvent) => void;
const listeners = new Set<Listener>();

export function subscribePipelineStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(event: PipelineStoreEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error("[pipeline-store] Error in listener:", e);
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("cyrene:pipeline-node-saved", {
        detail: event,
      }),
    );
  }
}

/**
 * Return a default initial pipeline document if none is in storage.
 */
export function getInitialPipeline(): PipelineData {
  const nodeTypes = ["dataset", "model", "compute", "training", "evaluation", "deployment", "agent"];
  const positions: [number, number][] = [
    [40, 80],
    [40, 260],
    [40, 440],
    [380, 220],
    [720, 80],
    [1060, 220],
    [1400, 220],
  ];

  const nodes: PipelineNodeData[] = nodeTypes.map((type) => {
    const d = definitions.get(type);
    return {
      id: type,
      type,
      typeVersion: "1",
      label: d?.title ?? type,
      config: { ...(d?.defaults ?? {}) },
    };
  });

  const edges: PipelineEdgeData[] = [
    { id: "edge-1", from: { node: "dataset", port: "dataset" }, to: { node: "training", port: "dataset" } },
    { id: "edge-2", from: { node: "model", port: "model" }, to: { node: "training", port: "model" } },
    { id: "edge-3", from: { node: "compute", port: "compute" }, to: { node: "training", port: "compute" } },
    { id: "edge-4", from: { node: "training", port: "model" }, to: { node: "evaluation", port: "model" } },
    { id: "edge-5", from: { node: "dataset", port: "dataset" }, to: { node: "evaluation", port: "dataset" } },
    { id: "edge-6", from: { node: "training", port: "model" }, to: { node: "deployment", port: "model" } },
    { id: "edge-7", from: { node: "evaluation", port: "evaluation" }, to: { node: "deployment", port: "evaluation" } },
    { id: "edge-8", from: { node: "compute", port: "compute" }, to: { node: "deployment", port: "compute" } },
    { id: "edge-9", from: { node: "deployment", port: "endpoint" }, to: { node: "agent", port: "endpoint" } },
  ];

  const presentationNodes: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n, i) => {
    presentationNodes[n.id] = { x: positions[i][0], y: positions[i][1] };
  });

  return {
    schemaVersion: "cyrene.pipeline.prototype.v1",
    id: "instruction-tuning",
    name: "指令微调与 Agent 验证",
    nodes,
    edges,
    presentation: { nodes: presentationNodes },
  };
}

/**
 * Load the current pipeline document from localStorage or fallback to initial.
 */
export function loadPipeline(): PipelineData {
  if (typeof window === "undefined" || !window.localStorage) {
    return getInitialPipeline();
  }
  try {
    const raw = window.localStorage.getItem(PIPELINE_STORAGE_KEY);
    if (!raw) return getInitialPipeline();
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.nodes) && parsed.presentation?.nodes) {
      return parsed as PipelineData;
    }
    return getInitialPipeline();
  } catch {
    return getInitialPipeline();
  }
}

/**
 * Persist the pipeline document to localStorage.
 */
export function savePipeline(pipeline: PipelineData): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(pipeline));
    } catch (e) {
      console.error("[pipeline-store] Failed to save pipeline to localStorage:", e);
    }
  }
}

/**
 * Save or update a node in the visual pipeline canvas.
 * If a node of matching nodeType already exists, its config & label are updated.
 * Otherwise, a new node is created and placed in the canvas.
 *
 * @param nodeType - catalog node type (e.g. 'dataset', 'training', 'evaluation', 'deployment', 'model', 'exchange_gateway', 'agent')
 * @param config - key-value configuration overrides
 * @param label - optional custom title/label for the node
 * @param settingsBinding - optional service binding link
 * @returns The updated or newly created PipelineNodeData
 */
export function saveOrUpdateNode(
  nodeType: string,
  config: Record<string, string | number>,
  label?: string,
  settingsBinding?: PipelineNodeData["settingsBinding"],
): PipelineNodeData {
  const pipeline = loadPipeline();
  const d = definitions.get(nodeType);

  let targetNode = pipeline.nodes.find((n) => n.type === nodeType);

  if (targetNode) {
    // Update existing node
    targetNode.config = {
      ...targetNode.config,
      ...config,
    };
    if (label) {
      targetNode.label = label;
    }
    if (settingsBinding) {
      targetNode.settingsBinding = settingsBinding;
    }
  } else {
    // Create new node
    const nodeId = `${nodeType}-${Date.now().toString(36)}`;
    const nodeLabel = label || d?.title || nodeType;
    const nodeConfig: Record<string, string | number> = {
      ...(d?.defaults ?? {}),
      ...config,
    };

    targetNode = {
      id: nodeId,
      type: nodeType,
      typeVersion: "1",
      label: nodeLabel,
      config: nodeConfig,
      ...(settingsBinding ? { settingsBinding } : {}),
    };

    pipeline.nodes.push(targetNode);

    // Calculate a nice position for the new node
    const nodeCount = pipeline.nodes.length;
    const x = 80 + (nodeCount % 5) * 280;
    const y = 80 + Math.floor(nodeCount / 5) * 180;
    pipeline.presentation.nodes[nodeId] = { x, y };
  }

  savePipeline(pipeline);

  notify({
    action: "saveOrUpdateNode",
    nodeType,
    node: targetNode,
    label,
    config,
  });

  return targetNode;
}
