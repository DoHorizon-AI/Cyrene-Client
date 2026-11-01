// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-assistant workspace                │
// │ Role: Assemble owner-backed memory, profile, and graph operations.  │
// │ 中文：模块职责：整合对话记忆、画像和图谱所属服务操作。                 │
// └─────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { newConversationMemoryKey, type ActiveProfile, type ConversationKind, type ConversationMessage, type ConversationPersona, type GraphChangeset, type GraphEdge, type GraphNode, type NavigatorApi, type ProfileCandidate, type ProfileCategory, type ProfileState, type ProfileSubjectKind } from "./api";
import { useI18n } from "./i18n";
import { errorMessage } from "./pages/shared";
import { ConversationMemoryPage } from "./conversation-memory";
import { ConversationOperationsPage } from "./conversation-operations";
import { ConversationPeripheralPage } from "./conversation-peripheral-page";
import "./conversation-assistant.css";

type AssistantTab = "memory" | "profiles" | "graph" | "operations" | "peripherals";
type AssistantPageProps = { api: NavigatorApi; workspaceId: string; canWrite: boolean };

/**
 * Present conversation capabilities as sections of one Navigator-owned workspace.
 * 中文：把对话能力整合为由 Navigator 管理的同一工作区分区。
 */
export function ConversationAssistantPage({ api, workspaceId, canWrite }: AssistantPageProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AssistantTab>("memory");
  const tabs: readonly { id: AssistantTab; label: string }[] = [
    { id: "memory", label: t("Memory") },
    { id: "profiles", label: t("Personas & profiles") },
    { id: "graph", label: t("Knowledge graph") },
    { id: "operations", label: t("Operations & recovery") },
    { id: "peripherals", label: t("Media & Bilibili") },
  ];
  return <div className="conversation-assistant">
    <nav className="conversation-assistant__tabs" role="tablist" aria-label={t("Conversation assistant sections")}>
      {tabs.map((tab) => <button key={tab.id} id={`conversation-assistant-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="conversation-assistant-panel" onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
    </nav>
    <div id="conversation-assistant-panel" role="tabpanel" aria-labelledby={`conversation-assistant-tab-${activeTab}`}>
      {activeTab === "memory" ? <ConversationMemoryPage api={api} workspaceId={workspaceId} canWrite={canWrite} />
        : activeTab === "operations" ? <ConversationOperationsPage api={api} workspaceId={workspaceId} canWrite={canWrite} />
          : activeTab === "peripherals" ? <ConversationPeripheralPage api={api} workspaceId={workspaceId} canWrite={canWrite} />
          : <ConversationDomainsPage api={api} workspaceId={workspaceId} canWrite={canWrite} section={activeTab} />}
    </div>
  </div>;
}

function ConversationDomainsPage({ api, workspaceId, canWrite, section }: AssistantPageProps & { section: "profiles" | "graph" }) {
  const { t } = useI18n();
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [conversationId, setConversationId] = useState("");
  const [conversationKind, setConversationKind] = useState<ConversationKind>("direct");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const aligned = !!workspaceId && hostWorkspaceId === workspaceId;
  const mayWrite = canWrite && aligned;

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true); setWorkspaceError(""); setHostWorkspaceId(null);
    if (!workspaceId) {
      setWorkspaceError(t("No workspace is selected.")); setWorkspaceLoading(false);
      return () => { active = false; };
    }
    void api.getSystemStatus().then((status) => {
      if (!active) return;
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (status.workspaceId !== workspaceId) throw new Error(t("Selected workspace does not match the Navigator host."));
      setHostWorkspaceId(status.workspaceId);
    }).catch((reason: unknown) => { if (active) setWorkspaceError(errorMessage(reason)); })
      .finally(() => { if (active) setWorkspaceLoading(false); });
    return () => { active = false; };
  }, [api, workspaceId, t]);

  return <div className="page-stack">
    {workspaceLoading || workspaceError ? <StateBlock kind={workspaceLoading ? "loading" : "error"} title={workspaceLoading ? t("Verifying Navigator workspace") : t("Conversation assistant unavailable")} detail={workspaceLoading ? t("Checking the paired host before reading workspace data.") : workspaceError} />
      : section === "profiles" ? <ConversationProfilesPanel api={api} workspaceId={workspaceId} conversationId={conversationId} conversationKind={conversationKind} setConversationId={setConversationId} setConversationKind={setConversationKind} mayWrite={mayWrite} busy={busy} setBusy={setBusy} error={error} setError={setError} notice={notice} setNotice={setNotice} reloadKey={reloadKey} setReloadKey={setReloadKey} />
        : <ConversationGraphPanel api={api} workspaceId={workspaceId} conversationId={conversationId} conversationKind={conversationKind} setConversationId={setConversationId} setConversationKind={setConversationKind} mayWrite={mayWrite} busy={busy} setBusy={setBusy} error={error} setError={setError} notice={notice} setNotice={setNotice} reloadKey={reloadKey} setReloadKey={setReloadKey} />}
  </div>;
}

type DomainPanelProps = {
  api: NavigatorApi; workspaceId: string; conversationId: string; conversationKind: ConversationKind;
  setConversationId: (value: string) => void; setConversationKind: (value: ConversationKind) => void;
  mayWrite: boolean; busy: string; setBusy: (value: string) => void; error: string; setError: (value: string) => void;
  notice: string; setNotice: (value: string) => void; reloadKey: number; setReloadKey: (update: (value: number) => number) => void;
};

function DomainScope({ conversationId, conversationKind, setConversationId, setConversationKind, busy }: Pick<DomainPanelProps, "conversationId" | "conversationKind" | "setConversationId" | "setConversationKind" | "busy">) {
  const { t } = useI18n();
  return <div className="conversation-assistant__scope">
    <label>{t("Conversation ID")}<input value={conversationId} onChange={(event) => setConversationId(event.target.value)} disabled={busy !== ""} /></label>
    <label>{t("Conversation kind")}<select value={conversationKind} onChange={(event) => setConversationKind(event.target.value as ConversationKind)} disabled={busy !== ""}><option value="direct">{t("Direct")}</option><option value="group">{t("Group")}</option><option value="channel">{t("Channel")}</option></select></label>
  </div>;
}

function ConversationProfilesPanel(props: DomainPanelProps) {
  const { t } = useI18n();
  const { api, workspaceId, conversationId, conversationKind, setConversationId, setConversationKind, mayWrite, busy, setBusy, error, setError, notice, setNotice, reloadKey, setReloadKey } = props;
  const [personas, setPersonas] = useState<ConversationPersona[]>([]);
  const [candidates, setCandidates] = useState<ProfileCandidate[]>([]);
  const [profiles, setProfiles] = useState<ActiveProfile[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadError, setLoadError] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [personaDescription, setPersonaDescription] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [personaConversations, setPersonaConversations] = useState("");
  const [personaEnabled, setPersonaEnabled] = useState(true);
  const [subjectKind, setSubjectKind] = useState<ProfileSubjectKind>("user");
  const [category, setCategory] = useState<ProfileCategory>("preference");
  const [candidateText, setCandidateText] = useState("");
  const [confidence, setConfidence] = useState("0.8");
  const [candidateExpiry, setCandidateExpiry] = useState("");
  const [candidatePersonaId, setCandidatePersonaId] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [candidateKey, setCandidateKey] = useState(newConversationMemoryKey);
  const [candidateState, setCandidateState] = useState<ProfileState | "">("");

  const load = useCallback(async () => {
    if (!mayWrite && !workspaceId) return;
    setLoadError("");
    const tasks: Promise<unknown>[] = [
      api.getConversationPersonas(workspaceId, conversationId.trim() || undefined),
      api.listProfileCandidates(workspaceId, { ...(candidateState ? { state: candidateState } : {}), limit: 100 }),
      api.listConversationProfiles(workspaceId, { ...(conversationId.trim() ? { conversationId: conversationId.trim() } : {}), state: "active", limit: 100 }),
    ];
    if (conversationId.trim()) tasks.push(api.getConversationMessages(workspaceId, { conversationId: conversationId.trim(), conversationKind, limit: 50 }));
    const results = await Promise.allSettled(tasks);
    const personaResult = results[0], candidateResult = results[1], profileResult = results[2], messagesResult = results[3];
    const failures: string[] = [];
    if (personaResult?.status === "fulfilled") setPersonas(personaResult.value as ConversationPersona[]); else failures.push(errorMessage(personaResult?.reason));
    if (candidateResult?.status === "fulfilled") setCandidates(candidateResult.value as ProfileCandidate[]); else failures.push(errorMessage(candidateResult?.reason));
    if (profileResult?.status === "fulfilled") setProfiles(profileResult.value as ActiveProfile[]); else failures.push(errorMessage(profileResult?.reason));
    if (conversationId.trim()) {
      if (messagesResult?.status === "fulfilled") setMessages((messagesResult.value as { items: ConversationMessage[] }).items); else { setMessages([]); failures.push(errorMessage(messagesResult?.reason)); }
    } else setMessages([]);
    if (failures.length) setLoadError(failures.join(" · "));
  }, [api, workspaceId, conversationId, conversationKind, candidateState, mayWrite]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const editPersona = (persona: ConversationPersona) => {
    setPersonaId(persona.id); setPersonaName(persona.name); setPersonaDescription(persona.description); setPersonaPrompt(persona.prompt);
    setPersonaConversations(persona.conversationIds.join(", ")); setPersonaEnabled(persona.enabled);
  };

  const savePersona = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !personaId.trim() || !personaName.trim() || !personaPrompt.trim() || busy) return;
    setBusy("persona"); setError(""); setNotice("");
    try {
      const saved = await api.putConversationPersona(workspaceId, {
        id: personaId.trim(), name: personaName.trim(), description: personaDescription.trim(), prompt: personaPrompt.trim(), enabled: personaEnabled,
        conversationIds: personaConversations.split(",").map((value) => value.trim()).filter(Boolean),
      });
      setNotice(`${t("Persona saved")}: ${saved.name} · v${saved.version}`);
      await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const createCandidate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !conversationId.trim() || !candidateText.trim() || !selectedSources.length || busy) return;
    const confidenceValue = Number(confidence);
    if (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1) { setError(t("Confidence must be between 0 and 1.")); return; }
    const expiry = parseLocalDateTime(candidateExpiry);
    if (candidateExpiry && expiry === null) { setError(t("Enter a valid expiry time.")); return; }
    const evidence = messages.filter((message) => selectedSources.includes(message.id));
    if (evidence.length !== selectedSources.length || evidence.some((message) => message.status !== "active" || message.scope.conversationId !== conversationId.trim() || message.scope.conversationKind !== conversationKind)) { setError(t("Load active source messages before creating a memory.")); return; }
    const evidencePersona = evidence[0]?.scope.personaId ?? null;
    if (evidence.some((message) => message.scope.personaId !== evidencePersona) || (candidatePersonaId.trim() && candidatePersonaId.trim() !== evidencePersona)) { setError(t("Selected evidence does not match the selected persona.")); return; }
    setBusy("candidate"); setError(""); setNotice("");
    try {
      const saved = await api.createProfileCandidate(workspaceId, {
        idempotencyKey: candidateKey, conversationId: conversationId.trim(), conversationKind, subjectKind, ...(candidatePersonaId.trim() ? { personaId: candidatePersonaId.trim() } : evidencePersona ? { personaId: evidencePersona } : {}),
        category, text: candidateText.trim(), sourceMessageIds: selectedSources, confidence: confidenceValue, ...(expiry !== null ? { validUntil: expiry } : {}),
      });
      setCandidateText(""); setSelectedSources([]); setCandidateExpiry(""); setCandidateKey(newConversationMemoryKey());
      setNotice(`${t("Profile candidate saved")}: ${saved.id}`);
      await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const activate = async (candidate: ProfileCandidate) => {
    if (!mayWrite || busy || !window.confirm(t("Activate this profile candidate? It will replace the active profile in its scope."))) return;
    setBusy(`activate:${candidate.id}`); setError(""); setNotice("");
    try {
      const profile = await api.activateProfileCandidate(workspaceId, candidate.id, candidate.version);
      setNotice(`${t("Profile activated")}: ${profile.id} · v${profile.version}`);
      await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const rollback = async (profile: ActiveProfile) => {
    if (!mayWrite || busy || !window.confirm(t("Roll back this profile and restore its previous version?"))) return;
    setBusy(`rollback:${profile.id}`); setError(""); setNotice("");
    try {
      const rolledBack = await api.rollbackConversationProfile(workspaceId, profile.id, profile.version);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      setNotice(`${t("Profile rolled back")}: ${rolledBack.id} · v${rolledBack.version}`);
      await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const visibleProfiles = profiles.filter((profile) => profile.conversationId === conversationId.trim() && profile.conversationKind === conversationKind);
  const visibleCandidates = candidates.filter((candidate) => candidate.conversationId === conversationId.trim() && candidate.conversationKind === conversationKind);

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Personas & profiles")} description={t("Bind reusable personas and review evidence-backed profile candidates before activation.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {!mayWrite && <p className="dh-notice product-readonly">{t("This session is read-only. Viewing is available; source, memory, and authorization changes require products.write.")}</p>}
    {error && <p className="dh-notice dh-notice--danger" role="alert">{error}</p>}{notice && <p className="dh-notice" role="status">{notice}</p>}
    <Panel title={t("Conversation scope")}>
      <DomainScope conversationId={conversationId} conversationKind={conversationKind} setConversationId={setConversationId} setConversationKind={setConversationKind} busy={busy} />
    </Panel>
    {loadError && <p role="alert" className="dh-notice dh-notice--danger">{loadError}</p>}
    <div className="conversation-assistant__grid">
      <Panel title={t("Personas")} meta={<span>{personas.length}</span>}>
        {personas.length ? <ul className="conversation-assistant__list">{personas.map((persona) => <li key={persona.id}><div><strong>{persona.name} · v{persona.version}</strong><p>{persona.description || t("No description")}</p><small>{persona.id} · {persona.enabled ? t("Enabled") : t("Disabled")} · {persona.conversationIds.join(", ") || t("Available to all conversations")}</small></div><Button onClick={() => editPersona(persona)}>{t("Edit")}</Button></li>)}</ul> : <StateBlock kind="empty" title={t("No personas configured")} detail={t("Navigator has not returned configured personas.")} />}
        <form className="conversation-assistant__form" onSubmit={(event) => void savePersona(event)}>
          <h3>{personaId ? t("Edit persona") : t("Add persona")}</h3>
          <label>{t("Persona ID")}<input value={personaId} onChange={(event) => setPersonaId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Name")}<input value={personaName} onChange={(event) => setPersonaName(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Description")}<textarea value={personaDescription} onChange={(event) => setPersonaDescription(event.target.value)} rows={2} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Persona prompt")}<textarea value={personaPrompt} onChange={(event) => setPersonaPrompt(event.target.value)} rows={4} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Conversation IDs (comma separated)")}<input value={personaConversations} onChange={(event) => setPersonaConversations(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label className="conversation-assistant__checkbox"><input type="checkbox" checked={personaEnabled} onChange={(event) => setPersonaEnabled(event.target.checked)} disabled={!mayWrite || busy !== ""} />{t("Enabled")}</label>
          <div className="conversation-assistant__actions"><Button tone="primary" disabled={!mayWrite || !personaId.trim() || !personaName.trim() || !personaPrompt.trim() || busy !== ""} loading={busy === "persona"}>{t("Save persona")}</Button><Button type="button" onClick={() => { setPersonaId(""); setPersonaName(""); setPersonaDescription(""); setPersonaPrompt(""); setPersonaConversations(""); setPersonaEnabled(true); }}>{t("Clear")}</Button></div>
        </form>
      </Panel>

      <Panel title={t("Active profiles")} meta={<span>{visibleProfiles.length}</span>}>
        {visibleProfiles.length ? <ul className="conversation-assistant__list">{visibleProfiles.map((profile) => <li key={profile.id}><div><strong>{profile.category} · {profile.subjectKind} · v{profile.version}</strong><p>{profile.text}</p><small>{profile.id} · {t("Candidate")}: {profile.candidateId} · {t("Sources")}: {profile.sourceMessageIds.join(", ")}</small></div><Button tone="danger" onClick={() => void rollback(profile)} disabled={!mayWrite || busy !== ""}>{t("Rollback")}</Button></li>)}</ul> : <StateBlock kind="empty" title={t("No active profiles")} detail={t("Navigator has not returned active profile records for this scope.")} />}
      </Panel>

      <Panel title={t("Profile candidate review")} meta={<div className="conversation-assistant__filter"><label>{t("State")}<select value={candidateState} onChange={(event) => setCandidateState(event.target.value as ProfileState | "")}><option value="">{t("All states")}</option><option value="candidate">{t("Candidate")}</option><option value="active">{t("Active")}</option><option value="rolled_back">{t("Rolled back")}</option><option value="expired">{t("Expired")}</option></select></label></div>}>
        {visibleCandidates.length ? <ul className="conversation-assistant__list">{visibleCandidates.map((candidate) => <li key={candidate.id}><div><strong>{candidate.category} · {candidate.state} · v{candidate.version}</strong><p>{candidate.text}</p><small>{candidate.id} · {candidate.subjectKind} · {t("Confidence")}: {candidate.confidence} · {t("Sources")}: {candidate.sourceMessageIds.join(", ")}</small></div>
          <div className="conversation-assistant__actions">{candidate.state === "candidate" && <Button onClick={() => void activate(candidate)} disabled={!mayWrite || busy !== ""}>{t("Activate")}</Button>}</div>
        </li>)}</ul> : <StateBlock kind="empty" title={t("No profile candidates")} detail={t("Navigator has not returned evidence-backed profile candidates.")} />}
        <form className="conversation-assistant__form" onSubmit={(event) => void createCandidate(event)}>
          <h3>{t("Propose a profile candidate")}</h3>
          <label>{t("Subject")}<select value={subjectKind} onChange={(event) => setSubjectKind(event.target.value as ProfileSubjectKind)} disabled={!mayWrite || busy !== ""}><option value="user">{t("User")}</option><option value="group">{t("Group")}</option></select></label>
          <label>{t("Persona ID (optional)")}<input value={candidatePersonaId} onChange={(event) => setCandidatePersonaId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Category")}<select value={category} onChange={(event) => setCategory(event.target.value as ProfileCategory)} disabled={!mayWrite || busy !== ""}><option value="preference">{t("Preference")}</option><option value="style">{t("Style")}</option><option value="constraint">{t("Constraint")}</option><option value="temporary_state">{t("Temporary state")}</option></select></label>
          <label>{t("Candidate text")}<textarea value={candidateText} onChange={(event) => setCandidateText(event.target.value)} rows={3} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Confidence (0–1)")}<input type="number" min="0" max="1" step="0.01" value={confidence} onChange={(event) => setConfidence(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Valid until (optional)")}<input type="datetime-local" value={candidateExpiry} onChange={(event) => setCandidateExpiry(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <div className="conversation-assistant__source-picker"><strong>{t("Evidence messages")}</strong>{messages.length ? messages.filter((message) => message.status === "active").map((message) => <label key={message.id}><input type="checkbox" checked={selectedSources.includes(message.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} disabled={!mayWrite || busy !== ""} /><span>{message.content}</span><small>{message.id}</small></label>) : <p>{t("Enter a conversation ID and refresh to load evidence.")}</p>}</div>
          <Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !candidateText.trim() || selectedSources.length === 0 || busy !== ""} loading={busy === "candidate"}>{t("Save candidate")}</Button>
        </form>
      </Panel>
    </div>
  </div>;
}

function ConversationGraphPanel(props: DomainPanelProps) {
  const { t } = useI18n();
  const { api, workspaceId, conversationId, conversationKind, setConversationId, setConversationKind, mayWrite, busy, setBusy, error, setError, notice, setNotice, reloadKey, setReloadKey } = props;
  const [changesets, setChangesets] = useState<GraphChangeset[]>([]);
  const [loadError, setLoadError] = useState("");
  const [graphMessages, setGraphMessages] = useState<ConversationMessage[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [nodeId, setNodeId] = useState("");
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeProperties, setNodeProperties] = useState("{}");
  const [edgeId, setEdgeId] = useState("");
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<Record<string, unknown> | null>(null);
  const [queryError, setQueryError] = useState("");
  const [graphKey, setGraphKey] = useState(newConversationMemoryKey);

  const load = useCallback(async () => {
    setLoadError("");
    const result = await Promise.allSettled([
      api.listGraphChangesets(workspaceId),
      ...(conversationId.trim() ? [api.getConversationMessages(workspaceId, { conversationId: conversationId.trim(), conversationKind, limit: 50 })] : []),
    ]);
    const failures: string[] = [];
    if (result[0]?.status === "fulfilled") setChangesets(result[0].value as GraphChangeset[]); else failures.push(errorMessage(result[0]?.reason));
    if (conversationId.trim()) {
      if (result[1]?.status === "fulfilled") setGraphMessages((result[1].value as { items: ConversationMessage[] }).items); else { setGraphMessages([]); failures.push(errorMessage(result[1]?.reason)); }
    } else setGraphMessages([]);
    if (failures.length) setLoadError(failures.join(" · "));
  }, [api, workspaceId, conversationId, conversationKind]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const visibleChangesets = changesets.filter((changeset) => changeset.conversationId === conversationId.trim() && changeset.conversationKind === conversationKind);

  const createProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !conversationId.trim() || !nodeId.trim() || !nodeLabel.trim() || selectedSources.length === 0 || busy) return;
    let properties: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(nodeProperties);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(t("Node properties must be a JSON object."));
      properties = parsed as Record<string, unknown>;
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Node properties are invalid JSON.")); return; }
    const activeSources = new Set(graphMessages.filter((message) => message.status === "active").map((message) => message.id));
    if (selectedSources.some((id) => !activeSources.has(id))) { setError(t("Load active source messages before creating a graph proposal.")); return; }
    const evidence = graphMessages.filter((message) => selectedSources.includes(message.id));
    if (evidence.some((message) => message.scope.conversationId !== conversationId.trim() || message.scope.conversationKind !== conversationKind)) { setError(t("Selected evidence does not match the conversation kind.")); return; }
    const evidencePersona = evidence[0]?.scope.personaId ?? null;
    if (evidence.some((message) => message.scope.personaId !== evidencePersona)) { setError(t("Selected evidence does not match the selected persona.")); return; }
    const nodes: GraphNode[] = [{ id: nodeId.trim(), label: nodeLabel.trim(), properties, sourceMessageIds: selectedSources }];
    const edges: GraphEdge[] = edgeId.trim() || edgeFrom.trim() || edgeTo.trim() || edgeLabel.trim() ? [{ id: edgeId.trim(), fromId: edgeFrom.trim(), toId: edgeTo.trim(), label: edgeLabel.trim(), sourceMessageIds: selectedSources }] : [];
    if (edges.length && (!edgeId.trim() || !edgeFrom.trim() || !edgeTo.trim() || !edgeLabel.trim())) { setError(t("Complete every edge field or leave the edge fields empty.")); return; }
    setBusy("graph-proposal"); setError(""); setNotice("");
    try {
      const result = await api.createGraphProposal(workspaceId, { idempotencyKey: graphKey, conversationId: conversationId.trim(), conversationKind, ...(evidencePersona ? { personaId: evidencePersona } : {}), nodes, edges });
      setGraphKey(newConversationMemoryKey()); setNotice(`${t("Graph proposal saved")}: ${result.id} · ${t("Provider applied")}: ${result.providerApplied ? t("Yes") : t("No")}`);
      setNodeId(""); setNodeLabel(""); setSelectedSources([]); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const searchGraph = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversationId.trim() || !query.trim() || busy) return;
    setBusy("graph-query"); setQueryError(""); setQueryResult(null);
    try { setQueryResult(await api.queryConversationGraph(workspaceId, { conversationId: conversationId.trim(), conversationKind, query: query.trim() })); }
    catch (reason) { setQueryError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const applyChangeset = async (changeset: GraphChangeset) => {
    if (!mayWrite || busy || !window.confirm(t("Apply this sourced changeset to the graph provider and verify its independent readback?"))) return;
    setBusy(`graph-apply:${changeset.id}`); setError(""); setNotice("");
    try {
      const applied = await api.applyGraphChangeset(workspaceId, changeset.id, changeset.version);
      setNotice(applied.providerApplied ? `${t("Graph provider applied and readback verified")}: ${applied.id} · ${t("Readback digest")}: ${applied.providerReceipt?.readbackDigest ?? t("Unknown")}` : `${t("Graph proposal remains unapplied")}: ${applied.id}`);
      await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Knowledge graph")} description={t("Propose evidence-backed graph changesets and inspect provider query readiness.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {error && <p className="dh-notice dh-notice--danger" role="alert">{error}</p>}{notice && <p className="dh-notice" role="status">{notice}</p>}{loadError && <p className="dh-notice dh-notice--danger" role="alert">{loadError}</p>}
    <Panel title={t("Conversation scope")}><DomainScope conversationId={conversationId} conversationKind={conversationKind} setConversationId={setConversationId} setConversationKind={setConversationKind} busy={busy} /></Panel>
    <div className="conversation-assistant__grid">
      <Panel title={t("Graph query")}>
        <form className="conversation-assistant__form" onSubmit={(event) => void searchGraph(event)}>
          <label>{t("Query graph")}<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <Button tone="primary" disabled={!conversationId.trim() || !query.trim() || busy !== ""} loading={busy === "graph-query"}>{t("Search graph")}</Button>
        </form>
        {queryError && <StateBlock kind="error" title={t("Graph query unavailable")} detail={queryError} />}
        {queryResult && <pre className="conversation-assistant__json">{JSON.stringify(queryResult, null, 2)}</pre>}
        <p className="conversation-assistant__help">{t("Graph query results are shown only when Navigator returns provider results; provider errors remain visible as returned.")}</p>
      </Panel>
      <Panel title={t("Graph changesets")} meta={<span>{visibleChangesets.length}</span>}>
        {visibleChangesets.length ? <ul className="conversation-assistant__list">{visibleChangesets.map((changeset) => <li key={changeset.id}><div><strong>{changeset.state} · v{changeset.version}</strong><small>{changeset.id} · {t("Digest")}: {changeset.digest}</small><small>{changeset.nodes.length} {t("nodes")} · {changeset.edges.length} {t("edges")} · {t("Provider status")}: {changeset.providerStatus}</small>{changeset.providerReceipt && <small>{t("Readback digest")}: {changeset.providerReceipt.readbackDigest} · {changeset.providerReceipt.nodeCount} {t("nodes")} · {changeset.providerReceipt.edgeCount} {t("edges")}</small>}</div>{changeset.state === "proposed" && <Button onClick={() => void applyChangeset(changeset)} disabled={!mayWrite || busy !== ""}>{t("Apply graph changeset")}</Button>}</li>)}</ul> : <StateBlock kind="empty" title={t("No graph changesets")} detail={t("Navigator has not returned graph proposals.")} />}
      </Panel>
    </div>
    <Panel title={t("Propose graph changeset")}>
      <form className="conversation-assistant__form" onSubmit={(event) => void createProposal(event)}>
        <label>{t("Node ID")}<input value={nodeId} onChange={(event) => setNodeId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
        <label>{t("Node label")}<input value={nodeLabel} onChange={(event) => setNodeLabel(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
        <label>{t("Node properties JSON")}<textarea value={nodeProperties} onChange={(event) => setNodeProperties(event.target.value)} rows={3} disabled={!mayWrite || busy !== ""} /></label>
        <div className="conversation-assistant__form-row"><label>{t("Edge ID (optional)")}<input value={edgeId} onChange={(event) => setEdgeId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("From node") }<input value={edgeFrom} onChange={(event) => setEdgeFrom(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("To node")}<input value={edgeTo} onChange={(event) => setEdgeTo(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Edge label")}<input value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} disabled={!mayWrite || busy !== ""} /></label></div>
        <div className="conversation-assistant__source-picker"><strong>{t("Evidence messages")}</strong>{graphMessages.length ? graphMessages.filter((message) => message.status === "active").map((message) => <label key={message.id}><input type="checkbox" checked={selectedSources.includes(message.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} disabled={!mayWrite || busy !== ""} /><span>{message.content}</span><small>{message.id}</small></label>) : <p>{t("Enter a conversation ID and refresh to load evidence.")}</p>}</div>
        <Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !nodeId.trim() || !nodeLabel.trim() || selectedSources.length === 0 || busy !== ""} loading={busy === "graph-proposal"}>{t("Save proposal")}</Button>
      </form>
    </Panel>
  </div>;
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
