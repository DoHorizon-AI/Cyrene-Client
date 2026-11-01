// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation-memory page                         │
// │ Role: Curate conversation sources, memory, and sharing permissions. │
// │ 中文：模块职责：管理对话来源、记忆内容与共享授权。                     │
// └─────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { newConversationMemoryKey, type ConversationKind, type ConversationMemory, type ConversationMemoryKind, type ConversationMemoryMatch, type ConversationMemorySource, type ConversationMessage, type ConversationVisibility, type NavigatorApi } from "./api";
import { useI18n } from "./i18n";
import { errorMessage } from "./pages/shared";
import "./conversation-memory.css";

const PAGE_SIZE = 50;

type PageProps = { api: NavigatorApi; workspaceId: string; canWrite: boolean };

/**
 * Render the conversation memory owner API through the paired Navigator session.
 * 中文：通过已配对的 Navigator session 展示对话记忆所属服务的数据和操作。
 */
export function ConversationMemoryPage({ api, workspaceId, canWrite }: PageProps) {
  const { t } = useI18n();
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [overview, setOverview] = useState<Awaited<ReturnType<NavigatorApi["getConversationMemoryOverview"]>> | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [conversationKind, setConversationKind] = useState<ConversationKind>("direct");
  const [personaId, setPersonaId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");

  const [memories, setMemories] = useState<ConversationMemory[]>([]);
  const [memoriesError, setMemoriesError] = useState("");
  const [memoryState, setMemoryState] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ConversationMemoryMatch[] | null>(null);
  const [queryError, setQueryError] = useState("");
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [editText, setEditText] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [draftKind, setDraftKind] = useState<ConversationMemoryKind>("fact");
  const [draftText, setDraftText] = useState("");
  const [draftVisibility, setDraftVisibility] = useState<ConversationVisibility>("private");
  const [draftValidUntil, setDraftValidUntil] = useState("");
  const [memoryKey, setMemoryKey] = useState(newConversationMemoryKey);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState("");
  const [sources, setSources] = useState<ConversationMemorySource[]>([]);
  const [sourcesError, setSourcesError] = useState("");
  const [grantSourceId, setGrantSourceId] = useState("");
  const [grantVisibility, setGrantVisibility] = useState<"conversation" | "workspace">("conversation");
  const [grantTargetConversationId, setGrantTargetConversationId] = useState("");
  const [grantExpiresAt, setGrantExpiresAt] = useState("");
  const workspaceProbe = useRef(0);
  const ownerRequest = useRef(0);
  const messageRequest = useRef(0);
  const queryRequest = useRef(0);

  const workspaceAligned = !!workspaceId && hostWorkspaceId === workspaceId;
  const selectedMemory = useMemo(() => memories.find((memory) => memory.id === selectedMemoryId) ?? null, [memories, selectedMemoryId]);
  const scopedSources = useMemo(() => sources.filter((source) => source.scope.conversationId === conversationId.trim() && source.scope.conversationKind === conversationKind), [sources, conversationId, conversationKind]);
  const mayWrite = canWrite && workspaceAligned;

  useEffect(() => {
    const generation = ++workspaceProbe.current;
    ownerRequest.current++;
    messageRequest.current++;
    setHostWorkspaceId(null);
    setWorkspaceLoading(true);
    setWorkspaceError("");
    setOverview(null);
    setMemories([]);
    setSources([]);
    setMessages([]);
    setMatches(null);
    setSelectedMemoryId("");
    setSelectedMessageIds([]);
    if (!workspaceId) {
      setWorkspaceError(t("No workspace is selected."));
      setWorkspaceLoading(false);
      return () => { workspaceProbe.current++; };
    }
    void api.getSystemStatus().then((status) => {
      if (generation !== workspaceProbe.current) return;
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (status.workspaceId !== workspaceId) throw new Error(t("Selected workspace does not match the Navigator host."));
      setHostWorkspaceId(status.workspaceId);
    }).catch((error: unknown) => {
      if (generation === workspaceProbe.current) setWorkspaceError(errorMessage(error));
    }).finally(() => {
      if (generation === workspaceProbe.current) setWorkspaceLoading(false);
    });
    return () => { workspaceProbe.current++; };
  }, [api, workspaceId, t]);

  const refreshOwnerData = useCallback(async () => {
    if (!workspaceAligned) return;
    const requestId = ++ownerRequest.current;
    setPageError("");
    setNotice("");
    if (!conversationId.trim()) {
      setMemories([]); setSources([]); setMemoriesError(""); setSourcesError(""); setSelectedMemoryId("");
      try {
        const result = await api.getConversationMemoryOverview(workspaceId);
        if (requestId === ownerRequest.current) { setOverview(result); setOverviewError(""); }
      } catch (error) {
        if (requestId === ownerRequest.current) { setOverview(null); setOverviewError(errorMessage(error)); }
      }
      return;
    }
    const [overviewResult, memoriesResult, sourcesResult] = await Promise.allSettled([
      api.getConversationMemoryOverview(workspaceId),
      api.listConversationMemories(workspaceId, { conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : {}), ...(memoryState ? { state: memoryState } : {}), limit: 100 }),
      api.listConversationMemorySources(workspaceId, conversationId.trim()),
    ]);
    if (requestId !== ownerRequest.current) return;
    if (overviewResult.status === "fulfilled") { setOverview(overviewResult.value); setOverviewError(""); }
    else { setOverview(null); setOverviewError(errorMessage(overviewResult.reason)); }
    if (memoriesResult.status === "fulfilled") {
      setMemories(memoriesResult.value.items);
      setMemoriesError("");
      setSelectedMemoryId((current) => memoriesResult.value.items.some((item) => item.id === current) ? current : "");
    } else { setMemories([]); setMemoriesError(errorMessage(memoriesResult.reason)); }
    if (sourcesResult.status === "fulfilled") { setSources(sourcesResult.value.items); setSourcesError(""); }
    else { setSources([]); setSourcesError(errorMessage(sourcesResult.reason)); }
    if ([overviewResult, memoriesResult, sourcesResult].every((result) => result.status === "rejected")) setPageError(t("Conversation memory services could not be read."));
  }, [api, workspaceAligned, workspaceId, conversationId, conversationKind, personaId, memoryState, t]);

  useEffect(() => {
    ownerRequest.current++;
    queryRequest.current++;
    setMemories([]);
    setSources([]);
    setMatches(null);
    setSelectedMemoryId("");
    setSelectedMessageIds([]);
    setGrantSourceId("");
  }, [workspaceId, conversationId, conversationKind, personaId, memoryState]);

  useEffect(() => {
    messageRequest.current++;
    setBusy((current) => current.startsWith("messages") ? "" : current);
    setMessages([]);
    setMessagesCursor(null);
  }, [workspaceId, conversationId]);

  useEffect(() => { void refreshOwnerData(); }, [refreshOwnerData, reloadKey]);

  useEffect(() => {
    if (!selectedMemory) {
      setEditText("");
      setEditValidUntil("");
      return;
    }
    setEditText(selectedMemory.text);
    setEditValidUntil(toLocalDateTime(selectedMemory.validUntil));
  }, [selectedMemory?.id]);

  const readMessages = async (cursor?: string) => {
    const selectedConversation = conversationId.trim();
    if (!workspaceAligned || !selectedConversation || busy) return;
    const requestId = ++messageRequest.current;
    setMessagesError("");
    setBusy(cursor ? "messages-more" : "messages");
    if (!cursor) { setMessages([]); setMessagesCursor(null); }
    try {
      const page = await api.getConversationMessages(workspaceId, { conversationId: selectedConversation, conversationKind, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      if (requestId !== messageRequest.current) return;
      setMessages((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items);
      setMessagesCursor(page.nextCursor);
    } catch (error) {
      if (requestId === messageRequest.current) setMessagesError(errorMessage(error));
    } finally {
      if (requestId === messageRequest.current) setBusy("");
    }
  };

  const searchMemories = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workspaceAligned || !conversationId.trim() || !query.trim() || overview?.capabilities.memoryProvider !== "ready") return;
    const requestId = ++queryRequest.current;
    setBusy("query"); setQueryError(""); setMatches(null);
    try {
      const result = await api.queryConversationMemories(workspaceId, { conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : {}), query: query.trim(), limit: 50 });
      if (requestId === queryRequest.current) setMatches(result.items);
    } catch (error) { if (requestId === queryRequest.current) setQueryError(errorMessage(error)); }
    finally { if (requestId === queryRequest.current) setBusy(""); }
  };

  const saveMemory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !conversationId.trim() || !draftText.trim() || selectedMessageIds.length === 0 || busy) return;
    const evidenceMessages = messages.filter((message) => selectedMessageIds.includes(message.id));
    if (evidenceMessages.length !== selectedMessageIds.length || evidenceMessages.some((message) => message.status !== "active")) {
      setPageError(t("Load active source messages before creating a memory."));
      return;
    }
    if (evidenceMessages.some((message) => message.scope.conversationKind !== conversationKind)) {
      setPageError(t("Selected evidence does not match the conversation kind."));
      return;
    }
    const evidencePersonaId = evidenceMessages[0]?.scope.personaId ?? null;
    if (evidenceMessages.some((message) => message.scope.personaId !== evidencePersonaId) || (personaId.trim() && personaId.trim() !== evidencePersonaId)) {
      setPageError(t("Selected evidence does not match the selected persona."));
      return;
    }
    setBusy("memory-create"); setPageError(""); setNotice("");
    const expiry = parseLocalDateTime(draftValidUntil);
    if (draftValidUntil && expiry === null) { setPageError(t("Enter a valid expiry time.")); setBusy(""); return; }
    try {
      const result = await api.createConversationMemory(workspaceId, {
        idempotencyKey: memoryKey,
        conversationId: conversationId.trim(),
        conversationKind,
        ...(personaId.trim() ? { personaId: personaId.trim() } : evidencePersonaId ? { personaId: evidencePersonaId } : {}),
        kind: draftKind,
        text: draftText.trim(),
        sourceMessageIds: selectedMessageIds,
        visibility: draftVisibility,
        ...(expiry !== null ? { validUntil: expiry } : {}),
      });
      setDraftText(""); setDraftValidUntil(""); setSelectedMessageIds([]); setMemoryKey(newConversationMemoryKey());
      setSelectedMemoryId(result.memory.id);
      setMatches(null);
      setNotice(result.duplicate ? t("This memory request was already applied; the existing record was returned.") : t("Memory saved with source attribution."));
      await refreshOwnerData();
      setSelectedMemoryId(result.memory.id);
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const updateMemory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !selectedMemory || busy) return;
    const expiry = parseLocalDateTime(editValidUntil);
    if (editValidUntil && expiry === null) { setPageError(t("Enter a valid expiry time.")); return; }
    const originalExpiry = selectedMemory.validUntil;
    if (originalExpiry !== null && !editValidUntil) { setPageError(t("The current Work API cannot clear an existing expiry; choose a new expiry or keep the current value.")); return; }
    const patch = {
      ...(editText.trim() !== selectedMemory.text ? { text: editText.trim() } : {}),
      ...(expiry !== null && expiry !== originalExpiry ? { validUntil: expiry } : {}),
    };
    if (!Object.keys(patch).length) return;
    setBusy(`memory-update:${selectedMemory.id}`); setPageError(""); setNotice("");
    try {
      const result = await api.updateConversationMemory(workspaceId, selectedMemory.id, patch);
      setMatches(null);
      setNotice(t("Memory correction saved."));
      await refreshOwnerData();
      setSelectedMemoryId(result.memory.id);
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const deleteMemory = async (memory: ConversationMemory) => {
    if (!mayWrite || busy || !window.confirm(t("Delete this memory? Its source messages remain available for audit."))) return;
    setBusy(`memory-delete:${memory.id}`); setPageError(""); setNotice("");
    try {
      const result = await api.deleteConversationMemory(workspaceId, memory.id);
      setMatches(null);
      setSelectedMemoryId("");
      setNotice(`${t("Memory deleted. Authorization epoch")}: ${result.authorizationEpoch}`);
      await refreshOwnerData();
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const revokeSource = async (source: ConversationMemorySource) => {
    if (!mayWrite || busy || source.status === "revoked" || !window.confirm(t("Revoke this source? Memories derived from it will stop appearing in recall and context."))) return;
    setBusy(`source-revoke:${source.id}`); setPageError(""); setNotice("");
    try {
      const result = await api.revokeConversationMemorySource(workspaceId, source.id);
      setGrantSourceId("");
      setNotice(`${t("Source revoked; derived contributions invalidated")}: ${result.invalidatedCount}`);
      await refreshOwnerData();
      setMatches(null);
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const createGrant = async () => {
    const source = sources.find((item) => item.id === grantSourceId);
    if (!mayWrite || !source?.canManageGrants || source.status !== "active" || busy) return;
    const targetConversation = grantTargetConversationId.trim();
    if (grantVisibility === "conversation" && !targetConversation) { setPageError(t("A conversation grant needs an exact target conversation ID.")); return; }
    const expiry = parseLocalDateTime(grantExpiresAt);
    if (grantExpiresAt && expiry === null) { setPageError(t("Enter a valid expiry time.")); return; }
    const target = grantVisibility === "conversation" ? targetConversation : t("The workspace");
    if (!window.confirm(`${t("Grant this source to")}: ${target}?`)) return;
    setBusy(`grant-create:${source.id}`); setPageError(""); setNotice("");
    try {
      const result = await api.createConversationMemorySourceGrant(workspaceId, source.id, {
        visibility: grantVisibility,
        ...(grantVisibility === "conversation" ? { targetConversationId: targetConversation } : {}),
        ...(expiry !== null ? { expiresAt: expiry } : {}),
      });
      setNotice(result.duplicate ? t("This sharing grant already exists.") : t("Source sharing grant saved."));
      setGrantTargetConversationId(""); setGrantExpiresAt("");
      await refreshOwnerData();
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const revokeGrant = async (source: ConversationMemorySource, grantId: string) => {
    if (!mayWrite || !source.canManageGrants || busy || !window.confirm(t("Revoke this sharing grant?"))) return;
    setBusy(`grant-revoke:${grantId}`); setPageError(""); setNotice("");
    try {
      await api.revokeConversationMemorySourceGrant(workspaceId, source.id, grantId);
      setNotice(t("Sharing grant revoked."));
      await refreshOwnerData();
    } catch (error) { setPageError(errorMessage(error)); }
    finally { setBusy(""); }
  };

  const selectMemoryForCorrection = (memoryId: string) => setSelectedMemoryId(memoryId);
  const toggleSourceMessage = (messageId: string) => setSelectedMessageIds((current) => current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId]);
  const openMatch = async (match: ConversationMemoryMatch) => {
    if (!workspaceAligned) return;
    let record = memories.find((memory) => memory.id === match.memoryId);
    if (!record) {
      try {
        const result = await api.listConversationMemories(workspaceId, { conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : {}), limit: 100 });
        setMemories(result.items);
        setMemoriesError("");
        record = result.items.find((memory) => memory.id === match.memoryId);
      } catch (error) {
        setMemoriesError(errorMessage(error));
        return;
      }
    }
    if (!record) {
      setMemoriesError(t("The matched memory is no longer available in this scope."));
      return;
    }
    if (record.version !== match.version) {
      setMemoriesError(t("This search result refers to an older memory version. Search again before correcting it."));
      return;
    }
    setMemoryState("");
    setSelectedMemoryId(match.memoryId);
    setSelectedMessageIds(match.sourceMessageIds);
    document.getElementById("conversation-memory-messages")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!match.sourceMessageIds.every((id) => messages.some((message) => message.id === id))) void readMessages();
  };
  const viewMemorySources = (memory: ConversationMemory) => {
    setSelectedMessageIds(memory.sourceMessageIds);
    document.getElementById("conversation-memory-messages")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!memory.sourceMessageIds.every((id) => messages.some((message) => message.id === id))) void readMessages();
  };
  const isReady = !workspaceLoading && workspaceAligned;

  return (
    <div className="page-stack conversation-memory">
      <PageHeader eyebrow="CONVERSATION ASSISTANT" title="Conversation memory" description="Inspect source messages, search attributed memories, correct records, and control sharing through Navigator." action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={!isReady || busy !== ""}>{busy === "" ? t("Refresh") : t("Working...")}</Button>} />
      {(workspaceLoading || workspaceError) && <StateBlock kind={workspaceLoading ? "loading" : "error"} title={workspaceLoading ? t("Verifying Navigator workspace") : t("Conversation memory unavailable")} detail={workspaceLoading ? t("Checking the paired host before reading workspace data.") : workspaceError} action={!workspaceLoading ? <Button onClick={() => setReloadKey((value) => value + 1)}>{t("Retry workspace connection")}</Button> : undefined} />}
      {isReady && !canWrite && <p className="dh-notice product-readonly">{t("This session is read-only. Viewing is available; source, memory, and authorization changes require products.write.")}</p>}
      {pageError && <p className="dh-notice dh-notice--danger" role="alert">{pageError}</p>}
      {notice && <p className="dh-notice" role="status">{notice}</p>}

      <Panel title={t("Conversation scope")} meta={overview ? <span>{t("Authorization epoch")}: {overview.authorizationEpoch}</span> : undefined}>
        <div className="conversation-memory__scope">
          <label>{t("Conversation ID")}<input value={conversationId} onChange={(event) => setConversationId(event.target.value)} autoComplete="off" disabled={busy !== ""} /></label>
          <label>{t("Conversation kind")}<select value={conversationKind} onChange={(event) => setConversationKind(event.target.value as ConversationKind)} disabled={busy !== ""}><option value="direct">{t("Direct")}</option><option value="group">{t("Group")}</option><option value="channel">{t("Channel")}</option></select></label>
          <label>{t("Persona ID (optional)")}<input value={personaId} onChange={(event) => setPersonaId(event.target.value)} autoComplete="off" disabled={busy !== ""} /></label>
          <Button onClick={() => { setReloadKey((value) => value + 1); setMatches(null); }} disabled={!isReady || busy !== ""}>{t("Load scope")}</Button>
        </div>
        {overviewError ? <StateBlock kind="error" title={t("Capability status unavailable")} detail={overviewError} /> : overview ? <div className="conversation-memory__capabilities">
          <span>{t("Messages")}: {overview.counts.messages}</span><span>{t("Memories")}: {overview.counts.memories}</span><span>{t("Sources")}: {overview.counts.sources}</span>
          <span>{t("Memory provider")}: <StatusPill value={overview.capabilities.memoryProvider} /></span><span>{t("Summarizer")}: <StatusPill value={overview.capabilities.summarizer} /></span>
        </div> : <StateBlock kind="loading" title={t("Reading conversation memory status")} detail={t("Counts and provider readiness are read from Navigator.")} />}
      </Panel>

      <div className="conversation-memory__grid">
        <Panel title={t("Search memories")} meta={<span>{memories.length} {t("records")}</span>}>
          <form className="conversation-memory__form" onSubmit={(event) => void searchMemories(event)}>
            <label>{t("Semantic query")}<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <Button tone="primary" disabled={!isReady || overview?.capabilities.memoryProvider !== "ready" || !conversationId.trim() || !query.trim() || busy !== ""} loading={busy === "query"}>{t("Search")}</Button>
          </form>
          {overview?.capabilities.memoryProvider === "unavailable" && <StateBlock kind="error" title={t("Memory provider unavailable")} detail={t("Navigator reports that semantic recall has no configured provider. No search results are shown.")} />}
          {queryError && <StateBlock kind="error" title={t("Memory search unavailable")} detail={queryError} />}
          {matches && (matches.length ? <ul className="conversation-memory__list">{matches.map((match) => <li key={match.memoryId}>
            <div><p>{match.text}</p><small>{match.kind} · {match.memoryId} · v{match.version} · {t("score")}: {match.score.toFixed(3)} · {match.stale ? t("stale") : t("current")}</small><small>{t("Sources")}: {match.sourceMessageIds.join(", ") || t("No source references")}</small>{match.sourceRefs.map((reference, index) => <small key={`${match.memoryId}:${index}`}>{t("Derived from")}: {reference.memoryId ?? t("conversation source")}{reference.memoryVersion === null ? "" : ` v${reference.memoryVersion}`} · {reference.sourceMessageIds.join(", ")}</small>)}</div>
            <Button onClick={() => void openMatch(match)}>{t("Open record")}</Button>
          </li>)}</ul> : <StateBlock kind="empty" title={t("No memory matches")} detail={t("Navigator returned no accessible memories for this query.")} />)}
        </Panel>

        <Panel title={t("Memory records")} meta={<div className="conversation-memory__filters"><label>{t("State")}<input value={memoryState} onChange={(event) => setMemoryState(event.target.value)} placeholder={t("Any state")} /></label><Button onClick={() => setReloadKey((value) => value + 1)} disabled={!isReady || busy !== ""}>{t("Apply")}</Button></div>}>
          {memoriesError ? <StateBlock kind="error" title={t("Memory records unavailable")} detail={memoriesError} /> : memories.length ? <ul className="conversation-memory__list">{memories.map((memory) => <li key={memory.id} className={memory.id === selectedMemoryId ? "is-selected" : undefined}>
            <div><strong>{memory.kind} · {memory.scope.visibility}</strong><p>{memory.text}</p><small>{memory.id} · v{memory.version} · {memory.state} · {t("Index")}: {memory.indexState} · {t("Updated")}: {formatEpoch(memory.updatedAt, t)}</small><small>{t("Sources")}: {memory.sourceMessageIds.join(", ") || t("No source references")}</small>{memory.sourceRefs.map((reference, index) => <small key={`${memory.id}:${index}`}>{t("Derived from")}: {reference.memoryId ?? t("conversation source")}{reference.memoryVersion === null ? "" : ` v${reference.memoryVersion}`} · {reference.sourceMessageIds.join(", ")}</small>)}</div>
            <div className="conversation-memory__actions"><Button onClick={() => selectMemoryForCorrection(memory.id)}>{t("Correct")}</Button><Button onClick={() => viewMemorySources(memory)}>{t("View sources")}</Button><Button tone="danger" onClick={() => void deleteMemory(memory)} disabled={!mayWrite || busy !== ""}>{t("Delete")}</Button></div>
          </li>)}</ul> : <StateBlock kind="empty" title={t("No memories in this scope")} detail={t("Navigator has not returned memory records for the selected filters.")} />}
        </Panel>
      </div>

      {selectedMemory && <Panel title={t("Correct selected memory")} meta={<span>{selectedMemory.id}</span>}>
        <form className="conversation-memory__form" onSubmit={(event) => void updateMemory(event)}>
          <label>{t("Corrected text")}<textarea rows={3} value={editText} onChange={(event) => setEditText(event.target.value)} /></label>
          <label>{t("Valid until (optional)")}<input type="datetime-local" value={editValidUntil} onChange={(event) => setEditValidUntil(event.target.value)} /></label>
          <p className="conversation-memory__help">{t("Source references and visibility remain attached to this record when you correct its text or expiry.")}</p>
          <Button tone="primary" disabled={!mayWrite || busy !== "" || !editText.trim()} loading={busy === `memory-update:${selectedMemory.id}`}>{t("Save correction")}</Button>
        </form>
      </Panel>}

      <div className="conversation-memory__grid">
        <Panel id="conversation-memory-messages" title={t("Conversation messages")} meta={<Button onClick={() => void readMessages()} disabled={!isReady || !conversationId.trim() || busy !== ""}>{t("Read messages")}</Button>}>
          {messagesError ? <StateBlock kind="error" title={t("Messages unavailable")} detail={messagesError} /> : messages.length ? <>
            <ul className="conversation-memory__list conversation-memory__messages">{messages.map((message) => <li key={message.id}>
              <label className="conversation-memory__source-select"><input type="checkbox" checked={selectedMessageIds.includes(message.id)} onChange={() => toggleSourceMessage(message.id)} disabled={!mayWrite || message.status === "revoked" || scopedSources.some((source) => source.id === message.id && source.status === "revoked")} /><span>{t("Use as evidence")}</span></label>
              <div><strong>{message.role} · {message.scope.visibility} · {message.status}</strong><p>{message.content}</p><small>{message.id} · {t("Event")}: {message.eventId} · {formatEpoch(message.occurredAt, t)}</small>{message.sourceRefs.map((reference, index) => <small key={`${message.id}:${index}`}>{t("Derived from")}: {reference.memoryId ?? t("conversation source")}{reference.memoryVersion === null ? "" : ` v${reference.memoryVersion}`} · {reference.sourceMessageIds.join(", ")}</small>)}</div>
            </li>)}</ul>
            {messagesCursor && <Button onClick={() => void readMessages(messagesCursor)} disabled={busy !== ""} loading={busy === "messages-more"}>{t("Load more messages")}</Button>}
          </> : <StateBlock kind="empty" title={t("No conversation messages loaded")} detail={t("Enter a conversation ID and read messages from Navigator to choose source evidence.")} />}
        </Panel>

        <Panel title={t("Authorized sources")} meta={<span>{scopedSources.length}</span>}>
          {sourcesError ? <StateBlock kind="error" title={t("Sources unavailable")} detail={sourcesError} /> : scopedSources.length ? <ul className="conversation-memory__list">{scopedSources.map((source) => <li key={source.id}>
            <div><strong>{source.role} · {source.status}</strong><small>{source.id} · {source.scope.visibility} · {source.scope.conversationId}</small><small>{t("Authorization epoch")}: {source.authorizationEpoch}{source.revokedAt !== null ? ` · ${t("Revoked")}: ${formatEpoch(source.revokedAt, t)}` : ""}</small>
              {source.grants.map((grant) => <div className="conversation-memory__grant" key={grant.id}><small>{grant.visibility === "workspace" ? t("Workspace") : `${t("Conversation")}: ${grant.targetConversationId}`} · {grant.status}{grant.expiresAt === null ? ` · ${t("No expiry")}` : ` · ${t("Expires")}: ${formatEpoch(grant.expiresAt, t)}`}</small><Button onClick={() => void revokeGrant(source, grant.id)} disabled={!mayWrite || !source.canManageGrants || source.status === "revoked" || grant.status === "revoked" || busy !== ""}>{grant.status === "revoked" ? t("Grant revoked") : t("Revoke grant")}</Button></div>)}
            </div>
            <div className="conversation-memory__actions"><Button onClick={() => { setGrantSourceId(source.id); setGrantTargetConversationId(""); }} disabled={!mayWrite || !source.canManageGrants || source.status !== "active" || busy !== ""}>{t("Grant sharing")}</Button><Button tone="danger" onClick={() => void revokeSource(source)} disabled={!mayWrite || source.status === "revoked" || busy !== ""}>{source.status === "revoked" ? t("Source revoked") : t("Revoke source")}</Button></div>
          </li>)}</ul> : <StateBlock kind="empty" title={t("No sources in this scope")} detail={t("Navigator has not returned authorized conversation sources.")} />}
        </Panel>
      </div>

      {grantSourceId && <Panel title={t("Grant source sharing")} meta={<span>{grantSourceId}</span>}>
        <div className="conversation-memory__form">
          <label>{t("Grant visibility")}<select value={grantVisibility} onChange={(event) => setGrantVisibility(event.target.value as "conversation" | "workspace")} disabled={!mayWrite || busy !== ""}><option value="conversation">{t("One conversation")}</option><option value="workspace">{t("Workspace")}</option></select></label>
          {grantVisibility === "conversation" && <label>{t("Target conversation ID")}<input value={grantTargetConversationId} onChange={(event) => setGrantTargetConversationId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>}
          <label>{t("Grant expires at (optional)")}<input type="datetime-local" value={grantExpiresAt} onChange={(event) => setGrantExpiresAt(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <p className="conversation-memory__help">{t("This grant applies to this source only. Conversation access requires an exact target; workspace access applies within this workspace.")}</p>
          <div className="conversation-memory__actions"><Button tone="primary" onClick={() => void createGrant()} disabled={!mayWrite || !sources.some((source) => source.id === grantSourceId && source.canManageGrants && source.status === "active") || (grantVisibility === "conversation" && !grantTargetConversationId.trim()) || busy !== ""} loading={busy === `grant-create:${grantSourceId}`}>{t("Grant access")}</Button><Button onClick={() => setGrantSourceId("")}>{t("Close")}</Button></div>
        </div>
      </Panel>}

      <div className="conversation-memory__grid">
        <Panel title={t("Create an attributed memory")}>
          <form className="conversation-memory__form" onSubmit={(event) => void saveMemory(event)}>
            <label>{t("Memory text")}<textarea rows={3} value={draftText} onChange={(event) => setDraftText(event.target.value)} /></label>
            <div className="conversation-memory__form-row">
              <label>{t("Kind")}<select value={draftKind} onChange={(event) => setDraftKind(event.target.value as ConversationMemoryKind)}><option value="fact">{t("Fact")}</option><option value="preference">{t("Preference")}</option><option value="commitment">{t("Commitment")}</option><option value="episode">{t("Episode")}</option></select></label>
              <label>{t("Sharing scope")}<select value={draftVisibility} onChange={(event) => setDraftVisibility(event.target.value as ConversationVisibility)}><option value="private">{t("Private")}</option><option value="conversation">{t("This conversation")}</option><option value="workspace">{t("Workspace")}</option></select></label>
            </div>
            <label>{t("Valid until (optional)")}<input type="datetime-local" value={draftValidUntil} onChange={(event) => setDraftValidUntil(event.target.value)} /></label>
            <p className="conversation-memory__help">{selectedMessageIds.length ? `${selectedMessageIds.length} ${t("source messages selected")}` : t("Select one or more source messages above. A memory cannot be saved without provenance.")}</p>
            <Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !draftText.trim() || selectedMessageIds.length === 0 || selectedMessageIds.some((id) => scopedSources.some((source) => source.id === id && source.status === "revoked")) || busy !== ""} loading={busy === "memory-create"}>{t("Save memory")}</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toLocalDateTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatEpoch(value: number | null, translate: (message: string) => string): string {
  if (value === null || !Number.isFinite(value)) return translate("Not set");
  const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
