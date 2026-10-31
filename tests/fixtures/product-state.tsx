import { createRoot } from "react-dom/client";
import { CatalystDataToolsPanel } from "../../apps/web/services/catalyst/src/CatalystDataToolsPanel";
import { WorkAssistantPage } from "../../apps/web/services/navigator/src/work-assistant";
import { NavigatorApi } from "../../apps/web/services/navigator/src/api";
import { ControlledLocaleProvider } from "../../apps/web/services/navigator/src/i18n";

const api = new NavigatorApi();
const catalyst = new URLSearchParams(location.search).get("fixture") === "catalyst";
createRoot(document.getElementById("root")!).render(<ControlledLocaleProvider locale="en-US" setLocale={() => {}}>{catalyst
  ? <CatalystDataToolsPanel datasets={[{ id: "dataset-1", name: "Fixture" }]} transport={{ requestProductResponse: (path, init) => fetch(path, init) }} />
  : <WorkAssistantPage api={api} workspaceId="local" canOperate canWrite />}</ControlledLocaleProvider>);
