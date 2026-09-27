// -----------------------------------------------------------------------------
// Module: src/canvas/pipeline-store.ts
// Role: Lightweight global store and event bus for Cyrene Flow Engine & pipeline.
// -----------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import {
  type Pipeline,
  type PipelineNode,
  createNode,
  examplePipeline,
  loadStoredPipeline,
  saveStoredPipeline,
  clearStoredPipeline,
} from "../model/pipeline";
import { definitions } from "../model/catalog";

type PipelineListener = (pipeline: Pipeline) => void;

class PipelineStore {
  private currentPipeline: Pipeline;
  private listeners = new Set<PipelineListener>();

  constructor() {
    this.currentPipeline = loadStoredPipeline();
  }

  getPipeline = (): Pipeline => {
    return this.currentPipeline;
  };

  subscribe = (listener: PipelineListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    const p = this.currentPipeline;
    for (const listener of this.listeners) {
      try {
        listener(p);
      } catch (err) {
        console.error("Error in pipeline subscriber:", err);
      }
    }
  }

  setPipeline = (pipeline: Pipeline, options?: { persist?: boolean }): void => {
    this.currentPipeline = pipeline;
    if (options?.persist !== false) {
      saveStoredPipeline(pipeline);
    }
    this.notify();
  };

  saveOrUpdateNode = (
    nodeType: string,
    config?: Record<string, string | number>,
    label?: string,
    settingsBinding?: PipelineNode["settingsBinding"]
  ): PipelineNode => {
    const resolvedType =
      nodeType === "gateway" && !definitions.has("gateway")
        ? "exchange_gateway"
        : nodeType;

    const existingIndex = this.currentPipeline.nodes.findIndex(
      (n) => n.type === resolvedType || (nodeType === "gateway" && n.type === "exchange_gateway")
    );

    let updatedNode: PipelineNode;
    let nextNodes: PipelineNode[];
    const nextPresentation = { ...this.currentPipeline.presentation.nodes };

    if (existingIndex >= 0) {
      const existing = this.currentPipeline.nodes[existingIndex];
      updatedNode = {
        ...existing,
        label: label?.trim() || existing.label,
        config: {
          ...existing.config,
          ...(config || {}),
        },
        ...(settingsBinding !== undefined
          ? { settingsBinding }
          : existing.settingsBinding
          ? { settingsBinding: existing.settingsBinding }
          : {}),
      };
      nextNodes = [...this.currentPipeline.nodes];
      nextNodes[existingIndex] = updatedNode;
    } else {
      updatedNode = createNode(resolvedType, undefined, config, settingsBinding);
      if (label?.trim()) {
        updatedNode.label = label.trim();
      }
      const count = this.currentPipeline.nodes.length;
      nextPresentation[updatedNode.id] = {
        x: 60 + (count % 4) * 340,
        y: 100 + Math.floor(count / 4) * 180,
      };
      nextNodes = [...this.currentPipeline.nodes, updatedNode];
    }

    const nextPipeline: Pipeline = {
      ...this.currentPipeline,
      nodes: nextNodes,
      presentation: {
        nodes: nextPresentation,
      },
    };

    this.setPipeline(nextPipeline, { persist: true });
    return updatedNode;
  };

  removeNode = (nodeId: string): void => {
    const nextNodes = this.currentPipeline.nodes.filter((n) => n.id !== nodeId);
    const nextEdges = this.currentPipeline.edges.filter(
      (e) => e.from.node !== nodeId && e.to.node !== nodeId
    );
    const nextPresentation = { ...this.currentPipeline.presentation.nodes };
    delete nextPresentation[nodeId];

    this.setPipeline(
      {
        ...this.currentPipeline,
        nodes: nextNodes,
        edges: nextEdges,
        presentation: {
          nodes: nextPresentation,
        },
      },
      { persist: true }
    );
  };

  resetToExample = (): Pipeline => {
    const initial = examplePipeline();
    this.setPipeline(initial, { persist: true });
    return initial;
  };

  clearPipeline = (): void => {
    clearStoredPipeline();
    const empty: Pipeline = {
      schemaVersion: "cyrene.pipeline.prototype.v1",
      id: "empty-pipeline",
      name: "新流水线",
      nodes: [],
      edges: [],
      presentation: { nodes: {} },
    };
    this.setPipeline(empty, { persist: true });
  };
}

export const pipelineStore = new PipelineStore();

export const getPipeline = pipelineStore.getPipeline;
export const setPipeline = pipelineStore.setPipeline;
export const saveOrUpdateNode = pipelineStore.saveOrUpdateNode;
export const removeNode = pipelineStore.removeNode;
export const resetToExample = pipelineStore.resetToExample;
export const clearPipeline = pipelineStore.clearPipeline;
export const subscribe = pipelineStore.subscribe;

export function usePipelineStore(): {
  pipeline: Pipeline;
  setPipeline: (pipeline: Pipeline, options?: { persist?: boolean }) => void;
  saveOrUpdateNode: (
    nodeType: string,
    config?: Record<string, string | number>,
    label?: string,
    settingsBinding?: PipelineNode["settingsBinding"]
  ) => PipelineNode;
  removeNode: (nodeId: string) => void;
  resetToExample: () => Pipeline;
  clearPipeline: () => void;
} {
  const pipeline = useSyncExternalStore(
    pipelineStore.subscribe,
    pipelineStore.getPipeline,
    pipelineStore.getPipeline
  );

  return {
    pipeline,
    setPipeline: pipelineStore.setPipeline,
    saveOrUpdateNode: pipelineStore.saveOrUpdateNode,
    removeNode: pipelineStore.removeNode,
    resetToExample: pipelineStore.resetToExample,
    clearPipeline: pipelineStore.clearPipeline,
  };
}
