import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CatalystDataToolsPanel } from "../../apps/web/services/catalyst/src/CatalystDataToolsPanel";
import { ConversationMemoryPage } from "../../apps/web/services/navigator/src/conversation-memory";
import { ConversationAssistantPage } from "../../apps/web/services/navigator/src/conversation-assistant";
import { ConversationChatPage } from "../../apps/web/services/navigator/src/conversation-chat";
import { WorkAssistantPage } from "../../apps/web/services/navigator/src/work-assistant";
import { NavigatorApi } from "../../apps/web/services/navigator/src/api";
import { ControlledLocaleProvider } from "../../apps/web/services/navigator/src/i18n";

const api = new NavigatorApi();
const catalyst = new URLSearchParams(location.search).get("fixture") === "catalyst";
const conversationMemory = new URLSearchParams(location.search).get("fixture") === "conversation-memory";
const conversationAssistant = new URLSearchParams(location.search).get("fixture") === "conversation-assistant";
const conversationChat = new URLSearchParams(location.search).get("fixture") === "conversation-chat";

function WorkAssistantFixture() {
  const initialWorkspace = new URLSearchParams(location.search).get("workspace") ?? "local";
  const [workspaceId, setWorkspaceId] = useState(initialWorkspace);
  return <>
    <button type="button" onClick={() => setWorkspaceId("workspace-a")}>Select A</button>
    <button type="button" onClick={() => setWorkspaceId("workspace-b")}>Select B</button>
    <WorkAssistantPage api={api} workspaceId={workspaceId} canOperate canWrite />
  </>;
}

function ConversationMemoryFixture() {
  const readOnly = new URLSearchParams(location.search).get("readonly") === "1";
  useEffect(() => { void api.getSession().catch(() => undefined); }, []);
  return <ConversationMemoryPage api={api} workspaceId="local" canWrite={!readOnly} />;
}

function ConversationAssistantFixture() {
  const readOnly = new URLSearchParams(location.search).get("readonly") === "1";
  useEffect(() => { void api.getSession().catch(() => undefined); }, []);
  return <ConversationAssistantPage api={api} workspaceId="local" canWrite={!readOnly} />;
}

function ConversationChatFixture() {
  useEffect(() => { void api.getSession().catch(() => undefined); }, []);
  return <ConversationChatPage api={api} workspaceId="local" canOperate />;
}

createRoot(document.getElementById("root")!).render(<ControlledLocaleProvider locale="en-US" setLocale={() => {}}>{catalyst
  ? <CatalystDataToolsPanel datasets={[{ id: "dataset-1", name: "Fixture" }]} transport={{ requestProductResponse: (path, init) => fetch(path, init) }} />
  : conversationAssistant ? <ConversationAssistantFixture /> : conversationChat ? <ConversationChatFixture /> : conversationMemory ? <ConversationMemoryFixture /> : <WorkAssistantFixture />}</ControlledLocaleProvider>);
