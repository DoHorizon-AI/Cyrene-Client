import { useEffect } from "react";
import type { EditorId } from "./EditorWorkspace";
import type { LeftTool, RightTool } from "./Chrome";

interface Options {
  editorTab: EditorId;
  running: boolean;
  undo(): void;
  redo(): void;
  save(): void;
  left(tool: LeftTool): void;
  right(tool: RightTool): void;
  toggleBottom(): void;
}

/** Route IDE shortcuts according to focus without consuming text-editor shortcuts. */
export function useShortcuts({ editorTab, running, undo, redo, save, left, right, toggleBottom }: Options) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".product-workspace, .monitor-window, .assistant-window")
        || (!target?.closest(".canvas-area, .ide-source-view") && ["product", "monitor", "assistant"].includes(editorTab))) return;
      const editingText = target?.isContentEditable || !!target?.closest("input, textarea, select");
      if ((event.ctrlKey || event.metaKey) && !editingText && !running) {
        if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
        else if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!running) save(); }
      if (event.altKey && !editingText && ["1", "2", "3", "0", "9"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "1") left("files");
        if (event.key === "2") left("nodes");
        if (event.key === "3") left("servers");
        if (event.key === "0") right("info");
        if (event.key === "9") toggleBottom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
