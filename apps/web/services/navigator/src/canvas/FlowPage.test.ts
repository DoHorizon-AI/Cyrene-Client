import { describe, it, expect } from "vitest";
import { serviceRouteForNode, FlowPage } from "./FlowPage";
import { GraphCanvas } from "./GraphCanvas";
import {
  saveOrUpdateNode,
  getPipeline,
  usePipelineStore,
  resetToExample,
} from "./pipeline-store";

describe("canvas and flow engine", () => {
  it("exports FlowPage and GraphCanvas components", () => {
    expect(FlowPage).toBeDefined();
    expect(GraphCanvas).toBeDefined();
  });

  it("maps node types to correct professional service routes", () => {
    expect(serviceRouteForNode("dataset").route).toBe("/catalyst");
    expect(serviceRouteForNode("model").route).toBe("/reactor");
    expect(serviceRouteForNode("training").route).toBe("/yield");
    expect(serviceRouteForNode("evaluation").route).toBe("/echo");
    expect(serviceRouteForNode("deployment").route).toBe("/reactor");
    expect(serviceRouteForNode("exchange_gateway").route).toBe("/exchange");
    expect(serviceRouteForNode("gateway").route).toBe("/exchange");
    expect(serviceRouteForNode("agent").route).toBe("/navigator");
    expect(serviceRouteForNode("compute").route).toBe("/settings");
  });

  it("exports pipeline store methods correctly", () => {
    expect(typeof saveOrUpdateNode).toBe("function");
    expect(typeof getPipeline).toBe("function");
    expect(typeof usePipelineStore).toBe("function");
    expect(typeof resetToExample).toBe("function");
  });
});
