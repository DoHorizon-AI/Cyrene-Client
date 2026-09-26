import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  examplePipeline,
  inspect,
  createNode,
  loadStoredPipeline,
  saveStoredPipeline,
  clearStoredPipeline,
  STORAGE_KEY,
} from "./pipeline";

describe("pipeline model", () => {
  it("creates and inspects the example pipeline without issues", () => {
    const pipeline = examplePipeline();
    expect(pipeline.nodes).toHaveLength(8);
    const result = inspect(pipeline);
    expect(result.issues).toEqual([]);
    expect(result.order).toHaveLength(8);
    expect(result.order[0]).toBe("dataset");
  });

  it("detects missing inputs", () => {
    const pipeline = examplePipeline();
    // remove edge to training
    pipeline.edges = pipeline.edges.filter((e) => !(e.to.node === "training" && e.from.node === "dataset"));
    const result = inspect(pipeline);
    expect(result.issues.some((i) => i.code === "MISSING_INPUT")).toBe(true);
    expect(result.order).toEqual([]);
  });

  it("detects cycle", () => {
    const pipeline = examplePipeline();
    // add backwards edge: deployment -> training
    pipeline.edges.push({
      id: "cycle-edge",
      from: { node: "deployment", port: "endpoint" },
      to: { node: "training", port: "model" },
    });
    const result = inspect(pipeline);
    expect(result.issues.some((i) => i.code === "CYCLE" || i.code === "PORT_TYPE" || i.code === "MULTIPLE_INPUT")).toBe(true);
  });

  it("creates nodes with default configs and custom configs", () => {
    const node = createNode("training", "custom-train", { epochs: 10 });
    expect(node.id).toBe("custom-train");
    expect(node.type).toBe("training");
    expect(node.config.epochs).toBe(10);
    expect(node.config.method).toBe("LoRA");
  });

  it("supports gateway alias", () => {
    const node = createNode("gateway", "gw-1");
    expect(node.type).toBe("exchange_gateway");
    expect(node.config.modelId).toBe("cyrene-chat-default");
  });

  describe("persistence", () => {
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
    });

    afterEach(() => {
      delete (globalThis as any).window;
    });

    it("saves, loads, and clears pipeline in localStorage", () => {
      const pipeline = examplePipeline();
      saveStoredPipeline(pipeline);
      const loaded = loadStoredPipeline();
      expect(loaded.id).toBe(pipeline.id);
      expect(loaded.nodes.length).toBe(pipeline.nodes.length);

      clearStoredPipeline();
      expect(mockStore[STORAGE_KEY]).toBeUndefined();
    });
  });
});
