import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  pipelineStore,
  saveOrUpdateNode,
  removeNode,
  resetToExample,
  clearPipeline,
  getPipeline,
} from "./pipeline-store";

describe("pipelineStore", () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    const mockLocalStorage = {
      getItem: (k: string) => mockStore[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStore[k] = v;
      },
      removeItem: (k: string) => {
        delete mockStore[k];
      },
      clear: () => {
        mockStore = {};
      },
    };
    (globalThis as any).window = { localStorage: mockLocalStorage };
    resetToExample();
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it("resets to example pipeline with 8 nodes", () => {
    const p = resetToExample();
    expect(p.nodes.length).toBe(8);
  });

  it("updates existing node configuration", () => {
    const node = saveOrUpdateNode("training", { epochs: 99 });
    expect(node.config.epochs).toBe(99);
    const p = getPipeline();
    const updated = p.nodes.find((n) => n.id === node.id);
    expect(updated?.config.epochs).toBe(99);
  });

  it("creates a new node if type does not exist", () => {
    clearPipeline();
    const p0 = getPipeline();
    expect(p0.nodes.length).toBe(0);

    const node = saveOrUpdateNode("dataset", { datasetRef: "custom-ref" }, "自定义数据集");
    expect(node.type).toBe("dataset");
    expect(node.label).toBe("自定义数据集");
    expect(node.config.datasetRef).toBe("custom-ref");

    const p1 = getPipeline();
    expect(p1.nodes.length).toBe(1);
    expect(p1.presentation.nodes[node.id]).toBeDefined();
  });

  it("removes a node and its edges", () => {
    resetToExample();
    const p0 = getPipeline();
    const trainNode = p0.nodes.find((n) => n.type === "training");
    expect(trainNode).toBeDefined();

    removeNode(trainNode!.id);
    const p1 = getPipeline();
    expect(p1.nodes.some((n) => n.id === trainNode!.id)).toBe(false);
    expect(
      p1.edges.some((e) => e.from.node === trainNode!.id || e.to.node === trainNode!.id)
    ).toBe(false);
    expect(p1.presentation.nodes[trainNode!.id]).toBeUndefined();
  });

  it("notifies subscribers when mutations occur", () => {
    let callCount = 0;
    const unsubscribe = pipelineStore.subscribe(() => {
      callCount++;
    });

    saveOrUpdateNode("compute", { count: 4 });
    expect(callCount).toBe(1);

    unsubscribe();
    saveOrUpdateNode("compute", { count: 8 });
    expect(callCount).toBe(1);
  });
});
