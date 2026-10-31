import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CatalystDataToolsPanel } from "../../apps/web/services/catalyst/src/CatalystDataToolsPanel";
import { WorkAssistantPage } from "../../apps/web/services/navigator/src/work-assistant";
import { NavigatorApi } from "../../apps/web/services/navigator/src/api";
import { ControlledLocaleProvider } from "../../apps/web/services/navigator/src/i18n";

const api = new NavigatorApi();
const catalyst = new URLSearchParams(location.search).get("fixture") === "catalyst";

function WorkAssistantFixture() {
  const initialWorkspace = new URLSearchParams(location.search).get("workspace") ?? "local";
  const [workspaceId, setWorkspaceId] = useState(initialWorkspace);
  return <>
    <button type="button" onClick={() => setWorkspaceId("workspace-a")}>Select A</button>
    <button type="button" onClick={() => setWorkspaceId("workspace-b")}>Select B</button>
    <WorkAssistantPage api={api} workspaceId={workspaceId} canOperate canWrite />
  </>;
}

createRoot(document.getElementById("root")!).render(<ControlledLocaleProvider locale="en-US" setLocale={() => {}}>{catalyst
  ? <CatalystDataToolsPanel datasets={[{ id: "dataset-1", name: "Fixture" }]} transport={{ requestProductResponse: (path, init) => fetch(path, init) }} />
  : <WorkAssistantFixture />}</ControlledLocaleProvider>);
