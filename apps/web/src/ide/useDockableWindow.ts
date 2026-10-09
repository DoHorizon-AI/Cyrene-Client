import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorWorkspaceHandle } from "./EditorWorkspace";
import type { RightTool, useIdeLayout } from "./Chrome";

interface Options {
  id: "monitor" | "assistant";
  initiallyExpanded: boolean;
  layoutRight: RightTool | null;
  setLayout: ReturnType<typeof useIdeLayout>["setLayout"];
  toggleRight(tool: RightTool): void;
  editorWorkspace: RefObject<EditorWorkspaceHandle | null>;
}

/** Keep one tool window alive while its host moves between a dock and the editor. */
export function useDockableWindow({ id, initiallyExpanded, layoutRight, setLayout, toggleRight, editorWorkspace }: Options) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visited, setVisited] = useState(false);
  const dock = useRef<HTMLDivElement>(null), center = useRef<HTMLDivElement>(null);

  useEffect(() => { if (layoutRight === id) setVisited(true); }, [layoutRight, id]);

  const activate = () => {
    setVisited(true);
    setExpanded(true);
    setLayout(value => value.right === id ? { ...value, right: null } : value);
  };
  const dockWindow = (toggle: boolean) => {
    setVisited(true);
    if (expanded) editorWorkspace.current?.merge("graph");
    setExpanded(false);
    if (toggle) toggleRight(id);
    else setLayout(value => ({ ...value, right: id, ...(innerWidth < 1000 ? { left: null } : {}) }));
  };
  const toggle = (expandEditor: () => void) => {
    setVisited(true);
    if (expanded) dockWindow(false);
    else expandEditor();
  };

  return { expanded, setExpanded, visited, dock, center, activate, toggle, dockWindow };
}
