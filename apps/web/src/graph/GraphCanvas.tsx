import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { LiteGraph, LGraph, LGraphCanvas } from "litegraph.js/build/litegraph.core.js";
import { createNode, type Pipeline, type PipelineNode } from "../../../../packages/pipeline-model";
import { TITLE_HEIGHT } from "../../../../packages/pipeline-model/geometry";
import { appendNode, editorNodes, loadGraph, portColors, snapshotGraph, type EditorGraph, type ClientNode } from "./adapter";

// The bundled LiteGraph declaration omits the drawing context from renderLink.
type RuntimeRenderLink = (
  ctx: CanvasRenderingContext2D, from: ArrayLike<number>, to: ArrayLike<number>,
  link: object | null, skipBorder: boolean, flow: boolean | null,
  color?: string | null, startDir?: number, endDir?: number, sublines?: number,
) => void;

// Keep mutation entrypoints inside the adapter. Raw LiteGraph imports, clipboard,
// property panels and menus would bypass the versioned document and node catalog.
// 所有变更入口都应保留在适配器中。直接导入 LiteGraph、使用剪贴板、属性面板或菜单，都会绕过带版本的文档模型和节点目录。
function createCanvas(element: HTMLCanvasElement, graph: LGraph, interactive: () => boolean) {
  // Upstream attachCanvas checks constructor equality, so use composition.
  // 上游 attachCanvas 会检查构造函数是否完全相同，因此这里采用组合方式。
  const options = { skip_events: true, skip_render: true };
  const canvas = new LGraphCanvas(element, graph, options);
  Reflect.set(canvas, "clear_background_color", "");
  Object.assign(LGraphCanvas.link_type_colors, portColors);
  canvas.render_connections_border = false;
  canvas.connections_width = 2.5;
  canvas.highquality_render = false; // LiteGraph's center link control is drawn only in this mode.
  Reflect.set(canvas, "render_link_tooltip", false);
  canvas.showLinkMenu = () => false;
  LiteGraph.NODE_TEXT_COLOR = "#f5f6f8";
  const renderLink = (canvas.renderLink as unknown as RuntimeRenderLink).bind(canvas);
  Reflect.set(canvas, "renderLink", ((ctx, from, to, link, skipBorder, flow, color, startDir, endDir, sublines) => {
    const activeSlot = Reflect.get(canvas, "connecting_output") ?? Reflect.get(canvas, "connecting_input");
    const dragColor = activeSlot ? portColors[String(activeSlot.type)] : undefined;
    renderLink(ctx, from, to, link, skipBorder, flow, link ? color : dragColor ?? color, startDir, endDir, sublines);
  }) satisfies RuntimeRenderLink);
  const drawConnections = canvas.drawConnections.bind(canvas);
  canvas.drawConnections = (ctx) => {
    // LiteGraph turns every link touching a selected node white. Keep the
    // artifact color visible while the node itself carries the selection cue.
    const highlighted = canvas.highlighted_links;
    canvas.highlighted_links = {};
    try { drawConnections(ctx); }
    finally {
      canvas.highlighted_links = highlighted;
      canvas.visible_links.length = 0; // Remove the center control's hover and click targets.
      Reflect.set(canvas, "over_link_center", null);
    }
  };
  canvas.processContextMenu = () => {};
  canvas.processDrop = () => {};
  canvas.showSearchBox = () => {};
  canvas.processKey = (event: KeyboardEvent) => {
    if (!interactive() || !element.contains(event.target as Node)) return;
    if ((event.ctrlKey || event.metaKey) && ["c", "v", "d"].includes(event.key.toLowerCase())) return;
    return LGraphCanvas.prototype.processKey.call(canvas, event);
  };
  canvas.unbindEvents = () => {
    // 0.7.14's cleanup uses mismatched callbacks and omits capture=true.
    // Remove the actual listeners before upstream clears its callback fields.
    // LiteGraph 0.7.14 的清理逻辑使用了不匹配的回调，且漏掉 capture=true。上游清空回调字段前，先移除实际注册的监听器。
    const handlers = canvas as unknown as Record<string, EventListener>;
    for (const target of [canvas.canvas, canvas.canvas.ownerDocument]) {
      for (const [event, field] of [
        ["mousedown", "_mousedown_callback"], ["mousemove", "_mousemove_callback"], ["mouseup", "_mouseup_callback"],
        ["pointerdown", "_mousedown_callback"], ["pointermove", "_mousemove_callback"], ["pointerup", "_mouseup_callback"],
        ["down", "_mousedown_callback"], ["move", "_mousemove_callback"], ["up", "_mouseup_callback"],
        ["keydown", "_key_callback"], ["keyup", "_key_callback"], ["dragover", "_doNothing"], ["dragend", "_doNothing"],
      ]) {
        if (handlers[field]) for (const capture of [true, false]) target.removeEventListener(event, handlers[field], capture);
      }
    }
    LGraphCanvas.prototype.unbindEvents.call(canvas);
  };
  canvas.bindEvents(); canvas.startRendering();
  return canvas;
}

export interface GraphHandle {
  snapshot(): Pipeline;
  load(p: Pipeline, options?: { silent?: boolean; fit?: boolean }): void;
  add(type: string): void;
  update(node: PipelineNode): void;
  remove(id: string): void;
  select(id: string): void;
  fit(): void;
  getView?(): { scale: number; offset: [number, number] } | undefined;
  setView?(view: { scale: number; offset: [number, number] }): void;
}
interface Props { initial: Pipeline; interactive?: boolean; onChange(p: Pipeline): void; onSelect(id: string | null): void }

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas(props, ref) {
  const container = useRef<HTMLDivElement>(null), canvasElement = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ graph: EditorGraph; canvas: LGraphCanvas } | null>(null);
  const base = useRef(props.initial);
  const callbacks = useRef(props); callbacks.current = props;
  const emit = useRef(() => {});
  const suppressed = useRef(false);
  const fit = () => {
    const current = live.current; if (!current) return;
    const nodes = editorNodes(current.graph); if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.pos[0])) - 35;
    const minY = Math.min(...nodes.map((n) => n.pos[1])) - 65;
    const width = Math.max(...nodes.map((n) => n.pos[0] + n.size[0])) - minX + 35;
    const height = Math.max(...nodes.map((n) => n.pos[1] + n.size[1])) - minY + 40;
    const c = current.canvas;
    const bounds = c.canvas.getBoundingClientRect();
    c.ds.scale = Math.min(1.15, bounds.width / width, bounds.height / height);
    c.ds.offset[0] = -minX + (bounds.width / c.ds.scale - width) / 2;
    c.ds.offset[1] = -minY + (bounds.height / c.ds.scale - height) / 2;
    c.setDirty(true, true);
  };
  useImperativeHandle(ref, () => ({
    snapshot() { return live.current ? snapshotGraph(live.current.graph, base.current) : base.current; },
    load(p, options) {
      suppressed.current = true;
      base.current = p;
      if (live.current) { loadGraph(live.current.graph, p); if (options?.fit !== false) fit(); }
      suppressed.current = false;
      callbacks.current.onSelect(null); if (!options?.silent) emit.current();
    },
    add(type) {
      const c = live.current; if (!c || editorNodes(c.graph).length >= 200) return;
      const bounds = c.canvas.canvas.getBoundingClientRect();
      const n = appendNode(c.graph, createNode(type), { x: bounds.width / (2 * c.canvas.ds.scale) - c.canvas.ds.offset[0] - 120, y: bounds.height / (2 * c.canvas.ds.scale) - c.canvas.ds.offset[1] });
      c.canvas.selectNode(n); callbacks.current.onSelect(n.properties.document.id); emit.current();
    },
    update(node) {
      const c = live.current; if (!c) return;
      const n = editorNodes(c.graph).find((n) => n.properties.document.id === node.id);
      if (n) { n.properties.document = structuredClone(node); n.title = node.label; c.canvas.setDirty(true, true); emit.current(); }
    },
    remove(id) {
      const c = live.current; if (!c) return;
      const n = editorNodes(c.graph).find((n) => n.properties.document.id === id);
      if (n) { c.graph.remove(n); callbacks.current.onSelect(null); emit.current(); }
    },
    select(id) {
      const c = live.current; if (!c) return;
      const n = editorNodes(c.graph).find((n) => n.properties.document.id === id);
      if (n) { c.canvas.selectNode(n); c.canvas.centerOnNode(n); callbacks.current.onSelect(id); }
    },
    fit,
    getView() { const c = live.current?.canvas; return c ? { scale: c.ds.scale, offset: [c.ds.offset[0], c.ds.offset[1]] } : undefined; },
    setView(view) { const c = live.current?.canvas; if (c) { c.ds.scale = view.scale; c.ds.offset[0] = view.offset[0]; c.ds.offset[1] = view.offset[1]; c.setDirty(true, true); } },
  }), []);

  useEffect(() => {
    const graph = new LGraph() as EditorGraph;
    loadGraph(graph, base.current);
    const canvas = createCanvas(canvasElement.current!, graph, () => callbacks.current.interactive !== false);
    canvas.background_image = "";
    canvas.clear_background = true;
    // This hook runs in graph coordinates, so the dots pan and zoom with nodes.
    const tile = document.createElement("canvas");
    tile.width = tile.height = 64;
    const tileContext = tile.getContext("2d")!;
    tileContext.fillStyle = "#44464c";
    tileContext.beginPath(); tileContext.arc(32, 32, 0.9, 0, Math.PI * 2); tileContext.fill();
    let gridPattern: CanvasPattern | null = null;
    canvas.onDrawBackground = (ctx, area) => {
      gridPattern ??= ctx.createPattern(tile, "repeat");
      if (!gridPattern) return;
      ctx.fillStyle = gridPattern;
      ctx.fillRect(area[0], area[1], area[2], area[3]);
    };
    canvas.render_shadows = false; canvas.render_canvas_border = false;
    canvas.allow_searchbox = false; canvas.show_info = false;
    canvas.title_text_font = "14px sans-serif";
    canvas.node_title_color = "#f5f6f8";
    canvas.inner_text_font = "12px sans-serif";
    const drawNodeShape = canvas.drawNodeShape.bind(canvas);
    canvas.drawNodeShape = (node, ctx, size, fgColor, bgColor, selected, mouseOver) => {
      // LiteGraph's selection path adds a six-pixel gap around the node. Draw
      // the stroke on its actual silhouette, before the sockets are painted.
      drawNodeShape(node, ctx, size, fgColor, bgColor, false, mouseOver);
      if (!selected) return;
      ctx.save();
      ctx.beginPath();
      const x = 0.5, y = -TITLE_HEIGHT + 0.5;
      const width = size[0], height = size[1] + TITLE_HEIGHT - 1;
      const radius = canvas.round_radius - 0.5;
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.strokeStyle = "#f4f5f7";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    };
    // LiteGraph treats zoom below 0.6 as a low-quality preview: it drops text
    // and replaces circular ports with squares. Keep the detailed node drawing
    // while leaving the actual view scale (and hit testing) unchanged.
    const drawNode = canvas.drawNode.bind(canvas);
    canvas.drawNode = (node, ctx) => {
      const scale = canvas.ds.scale;
      if (scale < 0.6) canvas.ds.scale = 0.6;
      try { drawNode(node, ctx); }
      finally { canvas.ds.scale = scale; }
    };
    canvas.centerOnNode = (node) => {
      const bounds = canvas.canvas.getBoundingClientRect();
      canvas.ds.offset[0] = -node.pos[0] - node.size[0] / 2 + bounds.width / (2 * canvas.ds.scale);
      canvas.ds.offset[1] = -node.pos[1] - node.size[1] / 2 + bounds.height / (2 * canvas.ds.scale);
      canvas.setDirty(true, true);
    };
    // Render at device resolution, but keep graph coordinates in CSS pixels.
    // LiteGraph's canvas dimensions are otherwise used for both, so its
    // drawing transform needs the backing-store ratio before the graph scale.
    let pixelRatioX = 1, pixelRatioY = 1;
    const toCanvasContext = canvas.ds.toCanvasContext.bind(canvas.ds);
    canvas.ds.toCanvasContext = (ctx) => {
      ctx.scale(pixelRatioX, pixelRatioY);
      toCanvasContext(ctx);
    };
    live.current = { graph, canvas };
    let disposed = false, queued = false;
    emit.current = () => {
      if (queued || disposed || suppressed.current) return;
      queued = true;
      queueMicrotask(() => {
        queued = false; if (disposed) return;
        // LiteGraph's multi-selection drag ignores individual pinned flags.
        // Restore fixed coordinates before publishing the edited document.
        // LiteGraph 的多选拖动会忽略各节点单独设置的固定标记。发布编辑后的文档前，先恢复固定节点的坐标。
        for (const n of editorNodes(graph)) {
          const position = base.current.presentation.nodes[n.properties.document.id];
          if (position?.pinned) { n.pos[0] = position.x; n.pos[1] = position.y; }
        }
        canvas.setDirty(true, true);
        const p = snapshotGraph(graph, base.current); base.current = p;
        callbacks.current.onChange(p);
      });
    };
    graph.onAfterChange = emit.current;
    graph.onConnectionChange = emit.current;
    graph.onNodeRemoved = emit.current;
    canvas.onNodeMoved = emit.current;
    canvas.onSelectionChange = (selected) => callbacks.current.onSelect((Object.values(selected)[0] as ClientNode | undefined)?.properties.document.id ?? null);
    canvas.onShowNodePanel = (node) => callbacks.current.onSelect((node as ClientNode).properties.document.id);
    const resize = () => {
      const box = container.current!.getBoundingClientRect();
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(box.width * ratio));
      const height = Math.max(1, Math.round(box.height * ratio));
      pixelRatioX = width / Math.max(1, box.width);
      pixelRatioY = height / Math.max(1, box.height);
      canvas.resize(width, height);
    };
    const observer = new ResizeObserver(resize); observer.observe(container.current!);
    let resolutionQuery: MediaQueryList;
    const onResolutionChange = () => { resize(); watchResolution(); };
    const watchResolution = () => {
      resolutionQuery?.removeEventListener("change", onResolutionChange);
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolutionQuery.addEventListener("change", onResolutionChange);
    };
    watchResolution();
    window.addEventListener("resize", resize);
    resize(); fit();
    return () => {
      disposed = true; observer.disconnect(); resolutionQuery.removeEventListener("change", onResolutionChange);
      window.removeEventListener("resize", resize); canvas.stopRendering(); canvas.unbindEvents();
      graph.detachCanvas(canvas); graph.stop(); live.current = null;
      graph.onAfterChange = undefined; graph.onConnectionChange = undefined; graph.onNodeRemoved = undefined;
      graph.clear(); emit.current = () => {};
    };
  }, []);
  return <div className="canvas-container" ref={container}><canvas ref={canvasElement} tabIndex={0} aria-label="流水线编辑画布" /></div>;
});
