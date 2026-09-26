import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { LGraph, LGraphCanvas } from "litegraph.js/build/litegraph.core.js";
import { createNode, type Pipeline, type PipelineNode } from "../model/pipeline";
import {
  appendNode,
  editorNodes,
  loadGraph,
  snapshotGraph,
  type EditorGraph,
  type ClientNode,
} from "./adapter";

function createCanvas(
  element: HTMLCanvasElement,
  graph: LGraph,
  interactive: () => boolean
): LGraphCanvas {
  const options = { skip_events: true, skip_render: true };
  const canvas = new LGraphCanvas(element, graph, options);
  Reflect.set(canvas, "clear_background_color", "");
  canvas.processContextMenu = () => {};
  canvas.processDrop = () => {};
  canvas.showSearchBox = () => {};

  canvas.processKey = (event: KeyboardEvent) => {
    if (!interactive() || !element.contains(event.target as Node)) return;
    if ((event.ctrlKey || event.metaKey) && ["c", "v", "d"].includes(event.key.toLowerCase())) {
      return;
    }
    return LGraphCanvas.prototype.processKey.call(canvas, event);
  };

  canvas.unbindEvents = () => {
    const handlers = canvas as unknown as Record<string, EventListener>;
    const targets = [canvas.canvas, canvas.canvas?.ownerDocument].filter(Boolean) as (EventTarget)[];
    for (const target of targets) {
      for (const [event, field] of [
        ["mousedown", "_mousedown_callback"],
        ["mousemove", "_mousemove_callback"],
        ["mouseup", "_mouseup_callback"],
        ["pointerdown", "_mousedown_callback"],
        ["pointermove", "_mousemove_callback"],
        ["pointerup", "_mouseup_callback"],
        ["down", "_mousedown_callback"],
        ["move", "_mousemove_callback"],
        ["up", "_mouseup_callback"],
        ["keydown", "_key_callback"],
        ["keyup", "_key_callback"],
        ["dragover", "_doNothing"],
        ["dragend", "_doNothing"],
      ]) {
        if (handlers[field]) {
          for (const capture of [true, false]) {
            try {
              target.removeEventListener(event, handlers[field], capture);
            } catch {}
          }
        }
      }
    }
    try {
      LGraphCanvas.prototype.unbindEvents.call(canvas);
    } catch {}
  };

  canvas.bindEvents();
  canvas.startRendering();
  return canvas;
}

export interface GraphHandle {
  snapshot(): Pipeline;
  load(p: Pipeline, options?: { silent?: boolean; fit?: boolean }): void;
  add(type: string, config?: Record<string, string | number>): void;
  update(node: PipelineNode): void;
  remove(id: string): void;
  select(id: string | null): void;
  fit(): void;
  highlightNode(nodeId: string | null, status?: "running" | "done" | "idle"): void;
  clearHighlights(): void;
}

interface Props {
  initial: Pipeline;
  interactive?: boolean;
  onChange?(p: Pipeline): void;
  onSelect?(id: string | null): void;
}

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const canvasElement = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ graph: EditorGraph; canvas: LGraphCanvas } | null>(null);
  const base = useRef(props.initial);
  const callbacks = useRef(props);
  callbacks.current = props;
  const emit = useRef(() => {});
  const suppressed = useRef(false);

  const fit = () => {
    const current = live.current;
    if (!current) return;
    const nodes = editorNodes(current.graph);
    if (!nodes.length) return;

    const minX = Math.min(...nodes.map((n) => n.pos[0])) - 40;
    const minY = Math.min(...nodes.map((n) => n.pos[1])) - 60;
    const width = Math.max(...nodes.map((n) => n.pos[0] + n.size[0])) - minX + 50;
    const height = Math.max(...nodes.map((n) => n.pos[1] + n.size[1])) - minY + 50;
    const c = current.canvas;

    c.ds.scale = Math.min(1.2, Math.max(0.3, Math.min(c.canvas.width / width, c.canvas.height / height)));
    c.ds.offset[0] = -minX + (c.canvas.width / c.ds.scale - width) / 2;
    c.ds.offset[1] = -minY + (c.canvas.height / c.ds.scale - height) / 2;
    c.setDirty(true, true);
  };

  useImperativeHandle(
    ref,
    () => ({
      snapshot() {
        return live.current ? snapshotGraph(live.current.graph, base.current) : base.current;
      },
      load(p, options) {
        suppressed.current = true;
        base.current = p;
        if (live.current) {
          loadGraph(live.current.graph, p);
          if (options?.fit !== false) fit();
        }
        suppressed.current = false;
        callbacks.current.onSelect?.(null);
        if (!options?.silent) emit.current();
      },
      add(type, config) {
        const c = live.current;
        if (!c || editorNodes(c.graph).length >= 200) return;
        const n = appendNode(
          c.graph,
          createNode(type, undefined, config),
          {
            x: Math.round(c.canvas.canvas.width / (2 * c.canvas.ds.scale) - c.canvas.ds.offset[0] - 120),
            y: Math.round(c.canvas.canvas.height / (2 * c.canvas.ds.scale) - c.canvas.ds.offset[1] - 40),
          }
        );
        c.canvas.selectNode(n);
        callbacks.current.onSelect?.(n.properties.document.id);
        emit.current();
      },
      update(node) {
        const c = live.current;
        if (!c) return;
        const n = editorNodes(c.graph).find((item) => item.properties.document.id === node.id);
        if (n) {
          n.properties.document = structuredClone(node);
          n.title = node.label;
          c.canvas.setDirty(true, true);
          emit.current();
        }
      },
      remove(id) {
        const c = live.current;
        if (!c) return;
        const n = editorNodes(c.graph).find((item) => item.properties.document.id === id);
        if (n) {
          c.graph.remove(n);
          callbacks.current.onSelect?.(null);
          emit.current();
        }
      },
      select(id) {
        const c = live.current;
        if (!c) return;
        if (!id) {
          c.canvas.deselectAllNodes();
          callbacks.current.onSelect?.(null);
          return;
        }
        const n = editorNodes(c.graph).find((item) => item.properties.document.id === id);
        if (n) {
          c.canvas.selectNode(n);
          c.canvas.centerOnNode(n);
          callbacks.current.onSelect?.(id);
        }
      },
      fit,
      highlightNode(nodeId, status = "running") {
        const c = live.current;
        if (!c) return;
        for (const n of editorNodes(c.graph)) {
          if (n.properties.document.id === nodeId) {
            n.executionStatus = status;
          }
        }
        c.canvas.setDirty(true, true);
      },
      clearHighlights() {
        const c = live.current;
        if (!c) return;
        for (const n of editorNodes(c.graph)) {
          n.executionStatus = undefined;
        }
        c.canvas.setDirty(true, true);
      },
    }),
    []
  );

  useEffect(() => {
    const graph = new LGraph() as EditorGraph;
    loadGraph(graph, base.current);
    const canvas = createCanvas(canvasElement.current!, graph, () => callbacks.current.interactive !== false);

    canvas.background_image = "";
    canvas.clear_background = true;
    canvas.render_shadows = false;
    canvas.render_canvas_border = false;
    canvas.allow_searchbox = false;
    canvas.show_info = false;
    canvas.title_text_font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    canvas.inner_text_font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    live.current = { graph, canvas };

    let disposed = false;
    let queued = false;

    emit.current = () => {
      if (queued || disposed || suppressed.current) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        for (const n of editorNodes(graph)) {
          const position = base.current.presentation.nodes[n.properties.document.id];
          if (position?.pinned) {
            n.pos[0] = position.x;
            n.pos[1] = position.y;
          }
        }
        canvas.setDirty(true, true);
        const p = snapshotGraph(graph, base.current);
        base.current = p;
        callbacks.current.onChange?.(p);
      });
    };

    graph.onAfterChange = emit.current;
    graph.onConnectionChange = emit.current;
    graph.onNodeRemoved = emit.current;
    canvas.onNodeMoved = emit.current;
    canvas.onSelectionChange = (selected) => {
      const first = (Object.values(selected)[0] as ClientNode | undefined);
      callbacks.current.onSelect?.(first?.properties.document.id ?? null);
    };
    canvas.onShowNodePanel = (node) => {
      callbacks.current.onSelect?.((node as ClientNode).properties.document.id);
    };

    const resize = () => {
      if (!container.current) return;
      const box = container.current.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        canvas.resize(Math.floor(box.width), Math.floor(box.height));
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current!);
    resize();
    fit();

    return () => {
      disposed = true;
      observer.disconnect();
      canvas.stopRendering();
      canvas.unbindEvents();
      graph.detachCanvas(canvas);
      graph.stop();
      live.current = null;
      graph.onAfterChange = undefined;
      graph.onConnectionChange = undefined;
      graph.onNodeRemoved = undefined;
      graph.clear();
      emit.current = () => {};
    };
  }, []);

  return (
    <div
      className="canvas-container"
      ref={container}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#0d181d",
      }}
    >
      <canvas
        ref={canvasElement}
        tabIndex={0}
        aria-label="流水线可视化编辑画布"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          outline: "none",
        }}
      />
    </div>
  );
});
