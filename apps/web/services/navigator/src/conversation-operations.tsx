// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Navigator conversation operations                           │
// │ Role: Manage maintenance, research, Nous, review, and import records.│
// │ 中文：模块职责：管理维护、研究、Nous、复盘和导入记录。                 │
// └─────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, PageHeader, Panel, StateBlock, StatusPill } from "./components";
import { newConversationMemoryKey, type ActorBackupArtifact, type ActiveBehaviorPolicy, type ConversationFocusItem, type ConversationFocusKind, type ConversationFocusState, type ConversationHandoff, type ConversationImportPreview, type ConversationImportResult, type ConversationKind, type ConversationMessage, type ConversationReviewEvent, type ConversationSourceReference, type ConversationWatch, type MaintenanceJob, type MaintenanceKind, type MaintenanceState, type NavigatorApi, type ResearchNote, type VerifiedConversationSkill } from "./api";
import { useI18n } from "./i18n";
import { errorMessage } from "./pages/shared";
import "./conversation-assistant.css";

type OperationsTab = "maintenance" | "research" | "nous" | "review-import";
type Props = { api: NavigatorApi; workspaceId: string; canWrite: boolean };

/**
 * Render owner-backed maintenance, research, and conversation lifecycle records.
 * 中文：展示由 Navigator 所属服务管理的维护、研究和对话生命周期记录。
 */
export function ConversationOperationsPage({ api, workspaceId, canWrite }: Props) {
  const { t } = useI18n();
  const [hostWorkspaceId, setHostWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [tab, setTab] = useState<OperationsTab>("maintenance");
  const [conversationId, setConversationId] = useState("");
  const [conversationKind, setConversationKind] = useState<ConversationKind>("direct");
  const [personaId, setPersonaId] = useState("");
  const aligned = !!workspaceId && hostWorkspaceId === workspaceId;
  const mayWrite = canWrite && aligned;

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true); setWorkspaceError(""); setHostWorkspaceId(null);
    void api.getSystemStatus().then((status) => {
      if (!active) return;
      if (!status.workspaceId) throw new Error(t("Navigator did not report a workspace identity."));
      if (status.workspaceId !== workspaceId) throw new Error(t("Selected workspace does not match the Navigator host."));
      setHostWorkspaceId(status.workspaceId);
    }).catch((reason: unknown) => { if (active) setWorkspaceError(errorMessage(reason)); })
      .finally(() => { if (active) setWorkspaceLoading(false); });
    return () => { active = false; };
  }, [api, workspaceId, t]);

  const tabs: readonly { id: OperationsTab; label: string }[] = [
    { id: "maintenance", label: t("Maintenance & Dream") },
    { id: "research", label: t("Research & watches") },
    { id: "nous", label: t("Focus & handoffs") },
    { id: "review-import", label: t("Review & import") },
  ];
  return <div className="conversation-assistant">
    <nav className="conversation-assistant__tabs" role="tablist" aria-label={t("Conversation operations sections")}>
      {tabs.map((item) => <button key={item.id} id={`conversation-operations-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="conversation-operations-panel" onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>
    <div id="conversation-operations-panel" role="tabpanel" aria-labelledby={`conversation-operations-tab-${tab}`}>
      {workspaceLoading || workspaceError ? <StateBlock kind={workspaceLoading ? "loading" : "error"} title={workspaceLoading ? t("Verifying Navigator workspace") : t("Conversation assistant unavailable")} detail={workspaceLoading ? t("Checking the paired host before reading workspace data.") : workspaceError} /> : <>
        {!canWrite && <p className="dh-notice product-readonly">{t("This session is read-only. Viewing is available; source, memory, and authorization changes require products.write.")}</p>}
        {tab === "maintenance" && <MaintenancePanel api={api} workspaceId={workspaceId} mayWrite={mayWrite} conversationId={conversationId} setConversationId={setConversationId} conversationKind={conversationKind} setConversationKind={setConversationKind} />}
        {tab === "research" && <ResearchPanel api={api} workspaceId={workspaceId} mayWrite={mayWrite} conversationId={conversationId} setConversationId={setConversationId} conversationKind={conversationKind} setConversationKind={setConversationKind} personaId={personaId} setPersonaId={setPersonaId} />}
        {tab === "nous" && <NousPanel api={api} workspaceId={workspaceId} mayWrite={mayWrite} conversationId={conversationId} setConversationId={setConversationId} conversationKind={conversationKind} setConversationKind={setConversationKind} personaId={personaId} setPersonaId={setPersonaId} />}
        {tab === "review-import" && <ReviewImportPanel api={api} workspaceId={workspaceId} mayWrite={mayWrite} />}
      </>}
    </div>
  </div>;
}

function ScopeFields({ conversationId, setConversationId, conversationKind, setConversationKind, personaId, setPersonaId, disabled = false }: {
  conversationId: string; setConversationId: (value: string) => void; conversationKind: ConversationKind;
  setConversationKind: (value: ConversationKind) => void; personaId?: string; setPersonaId?: (value: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  return <div className="conversation-assistant__scope">
    <label>{t("Conversation ID")}<input value={conversationId} onChange={(event) => setConversationId(event.target.value)} disabled={disabled} /></label>
    <label>{t("Conversation kind")}<select value={conversationKind} onChange={(event) => setConversationKind(event.target.value as ConversationKind)} disabled={disabled}><option value="direct">{t("Direct")}</option><option value="group">{t("Group")}</option><option value="channel">{t("Channel")}</option></select></label>
    {personaId !== undefined && setPersonaId && <label>{t("Persona ID (optional)")}<input value={personaId} onChange={(event) => setPersonaId(event.target.value)} disabled={disabled} /></label>}
  </div>;
}

function MaintenancePanel({ api, workspaceId, mayWrite, conversationId, setConversationId, conversationKind, setConversationKind }: {
  api: NavigatorApi; workspaceId: string; mayWrite: boolean; conversationId: string; setConversationId: (value: string) => void; conversationKind: ConversationKind; setConversationKind: (value: ConversationKind) => void;
}) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedJob, setSelectedJob] = useState<MaintenanceJob | null>(null);
  const [kind, setKind] = useState<MaintenanceKind>("dream");
  const [filterState, setFilterState] = useState<MaintenanceState | "">("");
  const [idempotencyKey, setIdempotencyKey] = useState(newConversationMemoryKey);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadJobs = useCallback(async () => {
    setError("");
    try {
      const items = await api.listMaintenanceJobs(workspaceId, { ...(filterState ? { state: filterState } : {}), limit: 100 });
      setJobs(items);
      setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    } catch (reason) { setJobs([]); setError(errorMessage(reason)); }
  }, [api, workspaceId, filterState]);
  useEffect(() => { void loadJobs(); }, [loadJobs, reloadKey]);
  useEffect(() => {
    if (!selectedId) { setSelectedJob(null); return; }
    let active = true;
    void api.getMaintenanceJob(workspaceId, selectedId).then((job) => { if (active) setSelectedJob(job); }, (reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [api, workspaceId, selectedId]);

  const queueJob = async (event: FormEvent<HTMLFormElement>, continuation = false) => {
    event.preventDefault();
    if (!mayWrite || busy) return;
    if (continuation && selectedJob && !window.confirm(t("Queue a new maintenance job from this saved checkpoint? The existing job will remain unchanged."))) return;
    setBusy(continuation ? "continue" : "create"); setError(""); setNotice("");
    const key = continuation ? newConversationMemoryKey() : idempotencyKey;
    try {
      const result = await api.createMaintenanceJob(workspaceId, {
        idempotencyKey: key, kind: continuation && selectedJob ? selectedJob.kind : kind,
        ...((continuation ? selectedJob?.conversationId : conversationId.trim()) ? { conversationId: continuation ? selectedJob?.conversationId ?? undefined : conversationId.trim() } : {}),
        ...((continuation ? selectedJob?.conversationId : conversationId.trim()) ? { conversationKind: continuation ? selectedJob?.conversationKind ?? "direct" : conversationKind } : {}),
        ...(continuation && selectedJob?.personaId ? { personaId: selectedJob.personaId } : {}),
        ...(continuation && selectedJob?.cursor ? { cursor: selectedJob.cursor } : {}),
      });
      setIdempotencyKey(newConversationMemoryKey()); setSelectedId(result.job.id); setSelectedJob(result.job);
      setNotice(result.duplicate ? t("This maintenance request was already queued.") : t("Maintenance job record queued."));
      await loadJobs();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const cancelJob = async (job: MaintenanceJob) => {
    if (!mayWrite || busy || !window.confirm(t("Cancel this queued maintenance job?"))) return;
    setBusy("cancel"); setError(""); setNotice("");
    try {
      const result = await api.cancelMaintenanceJob(workspaceId, job.id, job.version);
      setSelectedJob(result.job); setNotice(t("Maintenance job cancelled.")); await loadJobs();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Maintenance & Dream")} description={t("Read durable maintenance job state and queue work for the Navigator scheduler.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <Panel title={t("Queue maintenance job")}>
      <form className="conversation-assistant__form" onSubmit={(event) => void queueJob(event)}>
        <label>{t("Job kind")}<select value={kind} onChange={(event) => setKind(event.target.value as MaintenanceKind)} disabled={!mayWrite || busy !== ""}><option value="dream">Dream</option><option value="forget">{t("Forget")}</option><option value="daily_review">{t("Daily review")}</option><option value="backup">{t("Backup")}</option><option value="import">{t("Import")}</option></select></label>
        <label>{t("Conversation ID (optional)")}<input value={conversationId} onChange={(event) => setConversationId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
        {conversationId.trim() && <label>{t("Conversation kind")}<select value={conversationKind} onChange={(event) => setConversationKind(event.target.value as ConversationKind)} disabled={!mayWrite || busy !== ""}><option value="direct">{t("Direct")}</option><option value="group">{t("Group")}</option><option value="channel">{t("Channel")}</option></select></label>}
        <p className="conversation-assistant__help">{t("The Work route records a durable job request. A queued status does not prove a worker ran it; use the returned job state and checkpoint for readback.")}</p>
        <Button tone="primary" disabled={!mayWrite || busy !== ""} loading={busy === "create"}>{t("Queue job")}</Button>
      </form>
      {kind === "dream" && <StateBlock kind="error" title={t("Dream preview unavailable")} detail={t("Navigator currently exposes durable maintenance job state, but no Dream preview or worker execution endpoint is available yet.")} />}
    </Panel>
    <div className="conversation-assistant__grid">
      <Panel title={t("Maintenance jobs")} meta={<div className="conversation-assistant__filter"><label>{t("State")}<select value={filterState} onChange={(event) => setFilterState(event.target.value as MaintenanceState | "")}><option value="">{t("All states")}</option><option value="queued">{t("Queued")}</option><option value="running">{t("Running")}</option><option value="completed">{t("Completed")}</option><option value="failed">{t("Failed")}</option><option value="cancelled">{t("Cancelled")}</option></select></label></div>}>
        {jobs.length ? <ul className="conversation-assistant__list">{jobs.map((job) => <li key={job.id} className={job.id === selectedId ? "is-selected" : undefined}><button type="button" className="conversation-assistant__select" onClick={() => setSelectedId(job.id)}><strong>{job.kind} · {job.state}</strong><small>{job.id} · v{job.version} · {t("Processed")}: {job.processedCount}</small></button></li>)}</ul> : <StateBlock kind="empty" title={t("No maintenance jobs")} detail={t("Navigator has not returned maintenance jobs for this actor.")} />}
      </Panel>
      <Panel title={t("Job checkpoint")} meta={selectedJob ? <StatusPill value={selectedJob.state} /> : undefined}>
        {selectedJob ? <>
          <dl className="conversation-assistant__facts"><dt>{t("Job ID")}</dt><dd>{selectedJob.id}</dd><dt>{t("Task ID")}</dt><dd>{selectedJob.taskId}</dd><dt>{t("Version")}</dt><dd>{selectedJob.version} · {t("Queued version")}: {selectedJob.queuedVersion}</dd><dt>{t("Processed")}</dt><dd>{selectedJob.processedCount}</dd><dt>{t("Cursor")}</dt><dd>{selectedJob.cursor ?? t("Not set")}</dd><dt>{t("Checkpoint digest")}</dt><dd>{selectedJob.checkpointDigest ?? t("Not set")}</dd></dl>
          <details><summary>{t("Job details")}</summary><pre className="conversation-assistant__json">{JSON.stringify(selectedJob.details, null, 2)}</pre></details>
          {(selectedJob.state === "queued" || selectedJob.state === "running") && <Button tone="danger" onClick={() => void cancelJob(selectedJob)} disabled={!mayWrite || busy !== ""} loading={busy === "cancel"}>{t("Cancel job")}</Button>}
          {(selectedJob.state === "failed" || selectedJob.state === "cancelled") && selectedJob.cursor && <form onSubmit={(event) => void queueJob(event, true)}><Button tone="primary" disabled={!mayWrite || busy !== ""} loading={busy === "continue"}>{t("Queue from checkpoint")}</Button></form>}
        </> : <StateBlock kind="empty" title={t("Select a maintenance job")} detail={t("Select a real job record to inspect its latest checkpoint.")} />}
      </Panel>
    </div>
  </div>;
}

function ResearchPanel({ api, workspaceId, mayWrite, conversationId, setConversationId, conversationKind, setConversationKind, personaId, setPersonaId }: {
  api: NavigatorApi; workspaceId: string; mayWrite: boolean; conversationId: string; setConversationId: (value: string) => void;
  conversationKind: ConversationKind; setConversationKind: (value: ConversationKind) => void; personaId: string; setPersonaId: (value: string) => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ConversationMessage[]>([]), [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]), [skills, setSkills] = useState<VerifiedConversationSkill[]>([]), [watches, setWatches] = useState<ConversationWatch[]>([]);
  const [title, setTitle] = useState(""), [content, setContent] = useState("");
  const [watchTitle, setWatchTitle] = useState(""), [watchCondition, setWatchCondition] = useState(""), [watchNextCheck, setWatchNextCheck] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [noteKey, setNoteKey] = useState(newConversationMemoryKey), [watchKey, setWatchKey] = useState(newConversationMemoryKey);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => {
    if (!conversationId.trim()) { setMessages([]); setNotes([]); setWatches([]); return; }
    const results = await Promise.allSettled([
      api.getConversationMessages(workspaceId, { conversationId: conversationId.trim(), conversationKind, limit: 100 }),
      api.listResearchNotes(workspaceId, { conversationId: conversationId.trim(), limit: 100 }),
      api.listVerifiedConversationSkills(workspaceId, 100), api.listConversationWatches(workspaceId, { limit: 100 }),
    ]);
    const failures: string[] = [];
    if (results[0]?.status === "fulfilled") setMessages(results[0].value.items); else failures.push(errorMessage(results[0]?.reason));
    if (results[1]?.status === "fulfilled") setNotes(results[1].value); else failures.push(errorMessage(results[1]?.reason));
    if (results[2]?.status === "fulfilled") setSkills(results[2].value); else failures.push(errorMessage(results[2]?.reason));
    if (results[3]?.status === "fulfilled") setWatches(results[3].value); else failures.push(errorMessage(results[3]?.reason));
    setError(failures.join(" · "));
  }, [api, workspaceId, conversationId, conversationKind]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const selected = messages.filter((message) => selectedSources.includes(message.id) && message.status === "active");
  const consistentPersona = selected.length > 0 && selected.every((message) => message.scope.personaId === selected[0]?.scope.personaId);
  const personaMatchesEvidence = !personaId.trim() || personaId.trim() === (selected[0]?.scope.personaId ?? "");
  const evidenceMatchesScope = selected.length > 0 && selected.every((message) => message.scope.conversationId === conversationId.trim() && message.scope.conversationKind === conversationKind);
  const visibleNotes = notes.filter((note) => note.conversationId === conversationId.trim() && note.conversationKind === conversationKind && (!personaId.trim() || note.personaId === personaId.trim()));
  const visibleWatches = watches.filter((watch) => watch.conversationId === conversationId.trim() && watch.conversationKind === conversationKind && (!personaId.trim() || watch.personaId === personaId.trim()));

  const createNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !conversationId.trim() || !title.trim() || !content.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy) return;
    setBusy("note"); setError(""); setNotice("");
    try {
      const result = await api.createResearchNote(workspaceId, { idempotencyKey: noteKey, conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : selected[0]?.scope.personaId ? { personaId: selected[0].scope.personaId } : {}), title: title.trim(), content: content.trim(), sourceRefs: selected.map((message) => message.id) });
      setNoteKey(newConversationMemoryKey()); setTitle(""); setContent(""); setSelectedSources([]); setNotice(`${t("Research note saved")}: ${result.note.id}`); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  const createWatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mayWrite || !conversationId.trim() || !watchTitle.trim() || !watchCondition.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy) return;
    const nextCheckAt = parseLocalDateTime(watchNextCheck);
    if (watchNextCheck && nextCheckAt === null) { setError(t("Enter a valid check time.")); return; }
    setBusy("watch"); setError(""); setNotice("");
    try {
      const result = await api.createConversationWatch(workspaceId, { idempotencyKey: watchKey, conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : selected[0]?.scope.personaId ? { personaId: selected[0].scope.personaId } : {}), title: watchTitle.trim(), condition: watchCondition.trim(), sourceRefs: selected.map((message) => message.id), ...(nextCheckAt !== null ? { nextCheckAt } : {}) });
      setWatchKey(newConversationMemoryKey()); setWatchTitle(""); setWatchCondition(""); setWatchNextCheck(""); setSelectedSources([]); setNotice(`${t("Watch saved")}: ${result.watch.id}`); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const cancelWatch = async (watch: ConversationWatch) => {
    if (!mayWrite || busy || !window.confirm(t("Stop this watch?"))) return;
    setBusy(`watch:${watch.id}`); setError(""); setNotice("");
    try { await api.cancelConversationWatch(workspaceId, watch.id, watch.version); setNotice(t("Watch stopped.")); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Research & watches")} description={t("Save source-backed research notes and cancellable follow-up watches. Verified skills are listed only after Navigator's trusted action workflow completes.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <Panel title={t("Conversation scope")}><ScopeFields conversationId={conversationId} setConversationId={setConversationId} conversationKind={conversationKind} setConversationKind={setConversationKind} personaId={personaId} setPersonaId={setPersonaId} disabled={busy !== ""} /></Panel>
    <Panel title={t("Evidence messages")} meta={<span>{selected.length} {t("selected")}</span>}>
      {messages.length ? <div className="conversation-assistant__source-picker">{messages.filter((message) => message.status === "active").map((message) => <label key={message.id}><input type="checkbox" checked={selectedSources.includes(message.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} disabled={!mayWrite || busy !== ""} /><span>{message.content}</span><small>{message.id} · {message.scope.visibility} · {message.scope.personaId ?? t("No persona")}</small></label>)}</div> : <StateBlock kind="empty" title={t("No evidence messages loaded")} detail={t("Choose a conversation scope and refresh before creating source-backed records.")} />}
    </Panel>
    <div className="conversation-assistant__grid">
      <Panel title={t("Research notes")} meta={<span>{visibleNotes.length}</span>}>
        {visibleNotes.length ? <ul className="conversation-assistant__list">{visibleNotes.map((note) => <li key={note.id}><div><strong>{note.title} · rev {note.revision}</strong><p>{note.content}</p><small>{note.id} · {t("Sources")}: {formatSourceRefs(note.sourceRefs)}</small></div></li>)}</ul> : <StateBlock kind="empty" title={t("No research notes")} detail={t("Navigator has not returned sourced notes for this conversation.")} />}
        <form className="conversation-assistant__form" onSubmit={(event) => void createNote(event)}><h3>{t("Write research note")}</h3><p className="conversation-assistant__help">{t("Research notes are source-backed drafts. They do not represent an executed or verified skill.")}</p><label>{t("Title")}<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Content")}<textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !title.trim() || !content.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy !== ""} loading={busy === "note"}>{t("Save note")}</Button></form>
      </Panel>
      <Panel title={t("Verified skills")} meta={<span>{skills.length}</span>}>
        {skills.length ? <ul className="conversation-assistant__list">{skills.map((skill) => <li key={skill.id}><div><strong>{skill.name} · rev {skill.revision}</strong><p>{skill.content}</p><small>{t("Verified by")}: {skill.verifiedBy} · {t("Sources")}: {formatSourceRefs(skill.sourceRefs)}</small><small>{t("Verification receipt")}: {skill.operationReceiptId} · {t("Independent read receipt")}: {skill.independentReadReceiptId}</small></div><StatusPill value={skill.verified ? "verified" : "unverified"} /></li>)}</ul> : <StateBlock kind="empty" title={t("No verified skills")} detail={t("Navigator has not returned verified skills for this actor.")} />}
        <StateBlock kind="error" title={t("Verified skill creation unavailable")} detail={t("Only Navigator's trusted action producer can create a verified skill after an allowlisted action and independent effect readback. Client receipt IDs cannot create verified skills. Use Research Notes for an unverified source-backed draft.")} />
      </Panel>
      <Panel title={t("Watches")} meta={<span>{visibleWatches.length}</span>}>
        {visibleWatches.length ? <ul className="conversation-assistant__list">{visibleWatches.map((watch) => <li key={watch.id}><div><strong>{watch.title} · {watch.state}</strong><p>{watch.condition}</p><small>{watch.id} · v{watch.version} · {t("Next check")}: {formatEpoch(watch.nextCheckAt, t)}</small></div><Button tone="danger" onClick={() => void cancelWatch(watch)} disabled={!mayWrite || watch.state !== "active" || busy !== ""}>{watch.state === "active" ? t("Stop watch") : t("Stopped")}</Button></li>)}</ul> : <StateBlock kind="empty" title={t("No watches")} detail={t("Navigator has not returned watches for this actor.")} />}
        <form className="conversation-assistant__form" onSubmit={(event) => void createWatch(event)}><h3>{t("Add a follow-up watch")}</h3><label>{t("Title")}<input value={watchTitle} onChange={(event) => setWatchTitle(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Condition to watch for")}<textarea rows={2} value={watchCondition} onChange={(event) => setWatchCondition(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Next check at (optional)")}<input type="datetime-local" value={watchNextCheck} onChange={(event) => setWatchNextCheck(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !watchTitle.trim() || !watchCondition.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy !== ""} loading={busy === "watch"}>{t("Save watch")}</Button></form>
      </Panel>
    </div>
  </div>;
}

function NousPanel({ api, workspaceId, mayWrite, conversationId, setConversationId, conversationKind, setConversationKind, personaId, setPersonaId }: {
  api: NavigatorApi; workspaceId: string; mayWrite: boolean; conversationId: string; setConversationId: (value: string) => void;
  conversationKind: ConversationKind; setConversationKind: (value: ConversationKind) => void; personaId: string; setPersonaId: (value: string) => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ConversationMessage[]>([]), [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [focusItems, setFocusItems] = useState<ConversationFocusItem[]>([]), [policy, setPolicy] = useState<ActiveBehaviorPolicy | null>(null);
  const [handoffId, setHandoffId] = useState(""), [handoff, setHandoff] = useState<ConversationHandoff | null>(null);
  const [focusKind, setFocusKind] = useState<ConversationFocusKind>("commitment"), [focusSummary, setFocusSummary] = useState(""), [focusCondition, setFocusCondition] = useState(""), [focusDueAt, setFocusDueAt] = useState("");
  const [taskId, setTaskId] = useState(""), [sessionId, setSessionId] = useState(""), [handoffSummary, setHandoffSummary] = useState(""), [unresolvedItems, setUnresolvedItems] = useState(""), [unknownRefs, setUnknownRefs] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(false), [quietTimeZone, setQuietTimeZone] = useState("UTC"), [quietStart, setQuietStart] = useState("22:00"), [quietEnd, setQuietEnd] = useState("08:00"), [cooldown, setCooldown] = useState("900"), [allowInterjections, setAllowInterjections] = useState(false), [followupEnabled, setFollowupEnabled] = useState(false);
  const [focusKey, setFocusKey] = useState(newConversationMemoryKey), [handoffKey, setHandoffKey] = useState(newConversationMemoryKey);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(async () => {
    if (!conversationId.trim()) { setMessages([]); setFocusItems([]); setPolicy(null); return; }
    const results = await Promise.allSettled([
      api.getConversationMessages(workspaceId, { conversationId: conversationId.trim(), conversationKind, limit: 100 }),
      api.listConversationFocusItems(workspaceId, { conversationId: conversationId.trim(), limit: 100 }),
      api.getActiveBehaviorPolicy(workspaceId, conversationId.trim()),
    ]);
    const failures: string[] = [];
    if (results[0]?.status === "fulfilled") setMessages(results[0].value.items); else failures.push(errorMessage(results[0]?.reason));
    if (results[1]?.status === "fulfilled") setFocusItems(results[1].value); else failures.push(errorMessage(results[1]?.reason));
    if (results[2]?.status === "fulfilled") {
      const value = results[2].value; setPolicy(value); setPolicyEnabled(value.enabled); setQuietTimeZone(value.quietHours.timeZone); setQuietStart(value.quietHours.start); setQuietEnd(value.quietHours.end); setCooldown(String(value.cooldownSeconds)); setAllowInterjections(value.allowGroupInterjections); setFollowupEnabled(value.followupEnabled);
    } else failures.push(errorMessage(results[2]?.reason));
    setError(failures.join(" · "));
  }, [api, workspaceId, conversationId, conversationKind]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const selected = messages.filter((message) => selectedSources.includes(message.id) && message.status === "active");
  const consistentPersona = selected.length > 0 && selected.every((message) => message.scope.personaId === selected[0]?.scope.personaId);
  const personaMatchesEvidence = !personaId.trim() || personaId.trim() === (selected[0]?.scope.personaId ?? "");
  const evidenceMatchesScope = selected.length > 0 && selected.every((message) => message.scope.conversationId === conversationId.trim() && message.scope.conversationKind === conversationKind);
  const visibleFocusItems = focusItems.filter((item) => item.conversationId === conversationId.trim() && item.conversationKind === conversationKind && (!personaId.trim() || item.personaId === personaId.trim()));
  const createFocus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || !conversationId.trim() || !focusSummary.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy) return;
    const dueAt = parseLocalDateTime(focusDueAt); if (focusDueAt && dueAt === null) { setError(t("Enter a valid due time.")); return; }
    setBusy("focus"); setError(""); setNotice("");
    try {
      const result = await api.createConversationFocusItem(workspaceId, { idempotencyKey: focusKey, conversationId: conversationId.trim(), conversationKind, ...(personaId.trim() ? { personaId: personaId.trim() } : selected[0]?.scope.personaId ? { personaId: selected[0].scope.personaId } : {}), kind: focusKind, summary: focusSummary.trim(), sourceRefs: selected.map((message) => message.id), ...(dueAt !== null ? { dueAt } : {}), ...(focusCondition.trim() ? { condition: focusCondition.trim() } : {}) });
      setFocusKey(newConversationMemoryKey()); setFocusSummary(""); setFocusCondition(""); setFocusDueAt(""); setSelectedSources([]); setNotice(`${t("Focus item saved")}: ${result.item.id}`); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const transitionFocus = async (item: ConversationFocusItem, state: ConversationFocusState) => {
    if (!mayWrite || busy || !window.confirm(`${t("Change focus state to")}: ${t(state)}?`)) return;
    setBusy(`focus:${item.id}`); setError(""); setNotice("");
    try { await api.transitionConversationFocusItem(workspaceId, item.id, { state, expectedVersion: item.version }); setNotice(t("Focus item updated.")); await load(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  const createHandoff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || !conversationId.trim() || !taskId.trim() || !sessionId.trim() || !handoffSummary.trim() || !evidenceMatchesScope || !selected.every((message) => message.scope.conversationKind === "direct" && message.scope.personaId === null) || busy) return;
    if (!window.confirm(t("Create this minimal task handoff? It contains only listed unresolved and unknown operations."))) return;
    setBusy("handoff"); setError(""); setNotice("");
    try {
      const result = await api.createConversationHandoff(workspaceId, { idempotencyKey: handoffKey, conversationId: conversationId.trim(), conversationKind: "direct", taskId: taskId.trim(), sessionId: sessionId.trim(), summary: handoffSummary.trim(), unresolvedItems: unresolvedItems.split("\n").map((value) => value.trim()).filter(Boolean), unknownOperationRefs: unknownRefs.split("\n").map((value) => value.trim()).filter(Boolean), sourceRefs: selected.map((message) => message.id) });
      setHandoffKey(newConversationMemoryKey()); setHandoffId(result.handoff.id); setHandoff(result.handoff); setNotice(`${t("Handoff created")}: ${result.handoff.id}`); setSelectedSources([]);
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  const readHandoff = async () => {
    if (!handoffId.trim() || busy) return;
    setBusy("handoff-read"); setError("");
    try { setHandoff(await api.getConversationHandoff(workspaceId, handoffId.trim())); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(""); }
  };
  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || !conversationId.trim() || busy) return;
    const cooldownSeconds = Number(cooldown); if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 86_400) { setError(t("Cooldown must be between 0 and 86400 seconds.")); return; }
    if (!window.confirm(t("Save the active behavior policy for this conversation?"))) return;
    setBusy("policy"); setError(""); setNotice("");
    try {
      const result = await api.putActiveBehaviorPolicy(workspaceId, { conversationId: conversationId.trim(), enabled: policyEnabled, quietHours: { timeZone: quietTimeZone.trim(), start: quietStart, end: quietEnd }, cooldownSeconds, allowGroupInterjections: allowInterjections, followupEnabled, expectedVersion: policy?.version ?? 0 });
      setPolicy(result); setNotice(`${t("Behavior policy saved")}: v${result.version}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Focus & handoffs")} description={t("Track commitments, waits, and attention; create minimal task handoffs and configure active conversation behavior.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <Panel title={t("Conversation scope")}><ScopeFields conversationId={conversationId} setConversationId={setConversationId} conversationKind={conversationKind} setConversationKind={setConversationKind} personaId={personaId} setPersonaId={setPersonaId} disabled={busy !== ""} /></Panel>
    <Panel title={t("Evidence messages")} meta={<span>{selected.length} {t("selected")}</span>}>
      {messages.length ? <div className="conversation-assistant__source-picker">{messages.filter((message) => message.status === "active").map((message) => <label key={message.id}><input type="checkbox" checked={selectedSources.includes(message.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} disabled={!mayWrite || busy !== ""} /><span>{message.content}</span><small>{message.id} · {message.scope.conversationKind} · {message.scope.personaId ?? t("No persona")}</small></label>)}</div> : <StateBlock kind="empty" title={t("No evidence messages loaded")} detail={t("Choose a conversation scope and refresh before creating source-backed records.")} />}
    </Panel>
    <div className="conversation-assistant__grid">
      <Panel title={t("Focus items")} meta={<span>{visibleFocusItems.length}</span>}>
        {visibleFocusItems.length ? <ul className="conversation-assistant__list">{visibleFocusItems.map((item) => <li key={item.id}><div><strong>{item.kind} · {item.state} · v{item.version}</strong><p>{item.summary}</p><small>{item.id} · {t("Sources")}: {formatSourceRefs(item.sourceRefs)}</small></div><div className="conversation-assistant__actions">{item.state === "open" && <Button onClick={() => void transitionFocus(item, "waiting")} disabled={!mayWrite || busy !== ""}>{t("Wait")}</Button>}{item.state === "waiting" && <Button onClick={() => void transitionFocus(item, "open")} disabled={!mayWrite || busy !== ""}>{t("Reopen")}</Button>}{(item.state === "open" || item.state === "waiting") && <Button onClick={() => void transitionFocus(item, "done")} disabled={!mayWrite || busy !== ""}>{t("Complete")}</Button>}{(item.state === "open" || item.state === "waiting") && <Button tone="danger" onClick={() => void transitionFocus(item, "cancelled")} disabled={!mayWrite || busy !== ""}>{t("Cancel")}</Button>}</div></li>)}</ul> : <StateBlock kind="empty" title={t("No focus items")} detail={t("Navigator has not returned focus items for this conversation.")} />}
        <form className="conversation-assistant__form" onSubmit={(event) => void createFocus(event)}><h3>{t("Add focus item")}</h3><label>{t("Focus kind")}<select value={focusKind} onChange={(event) => setFocusKind(event.target.value as ConversationFocusKind)} disabled={!mayWrite || busy !== ""}><option value="commitment">{t("Commitment")}</option><option value="wait">{t("Wait")}</option><option value="attention">{t("Attention")}</option></select></label><label>{t("Summary")}<textarea rows={2} value={focusSummary} onChange={(event) => setFocusSummary(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Condition (optional)")}<input value={focusCondition} onChange={(event) => setFocusCondition(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Due at (optional)")}<input type="datetime-local" value={focusDueAt} onChange={(event) => setFocusDueAt(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !focusSummary.trim() || !evidenceMatchesScope || !consistentPersona || !personaMatchesEvidence || busy !== ""} loading={busy === "focus"}>{t("Save focus item")}</Button></form>
      </Panel>
      <Panel title={t("Task handoff")}>
        <form className="conversation-assistant__form" onSubmit={(event) => void createHandoff(event)}><label>{t("Task ID")}<input value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Session ID")}<input value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Handoff summary")}<textarea rows={2} value={handoffSummary} onChange={(event) => setHandoffSummary(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Unresolved items (one per line)")}<textarea rows={3} value={unresolvedItems} onChange={(event) => setUnresolvedItems(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Unknown operation references (one per line)")}<textarea rows={2} value={unknownRefs} onChange={(event) => setUnknownRefs(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><p className="conversation-assistant__help">{t("Handoffs are summaries, not copies of task history. Unknown operation references remain explicit.")}</p><Button tone="primary" disabled={!mayWrite || !conversationId.trim() || !taskId.trim() || !sessionId.trim() || !handoffSummary.trim() || !evidenceMatchesScope || !selected.every((message) => message.scope.conversationKind === "direct" && message.scope.personaId === null) || busy !== ""} loading={busy === "handoff"}>{t("Create handoff")}</Button></form>
        <div className="conversation-assistant__inline-read"><label>{t("Read handoff ID")}<input value={handoffId} onChange={(event) => setHandoffId(event.target.value)} /></label><Button onClick={() => void readHandoff()} disabled={!handoffId.trim() || busy !== ""}>{t("Read handoff")}</Button></div>
        {handoff && <dl className="conversation-assistant__facts"><dt>{t("Handoff")}</dt><dd>{handoff.id}</dd><dt>{t("Unresolved items")}</dt><dd>{handoff.unresolvedItems.join(" · ") || t("None")}</dd><dt>{t("Unknown operations")}</dt><dd>{handoff.unknownOperationRefs.join(" · ") || t("None")}</dd></dl>}
      </Panel>
    </div>
    <Panel title={t("Active behavior policy")} meta={policy ? <span>{policy.version === 0 ? t("Unsaved defaults") : `v${policy.version}`}</span> : undefined}>
      <form className="conversation-assistant__form" onSubmit={(event) => void savePolicy(event)}>
        <label className="conversation-assistant__checkbox"><input type="checkbox" checked={policyEnabled} onChange={(event) => setPolicyEnabled(event.target.checked)} disabled={!mayWrite || busy !== ""} />{t("Enable active behavior")}</label>
        <div className="conversation-assistant__form-row"><label>{t("Quiet hours time zone")}<input value={quietTimeZone} onChange={(event) => setQuietTimeZone(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Quiet hours start")}<input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Quiet hours end")}<input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Cooldown seconds")}<input type="number" min="0" max="86400" value={cooldown} onChange={(event) => setCooldown(event.target.value)} disabled={!mayWrite || busy !== ""} /></label></div>
        <label className="conversation-assistant__checkbox"><input type="checkbox" checked={allowInterjections} onChange={(event) => setAllowInterjections(event.target.checked)} disabled={!mayWrite || busy !== ""} />{t("Allow group interjections")}</label><label className="conversation-assistant__checkbox"><input type="checkbox" checked={followupEnabled} onChange={(event) => setFollowupEnabled(event.target.checked)} disabled={!mayWrite || busy !== ""} />{t("Enable follow-up")}</label>
        <p className="conversation-assistant__help">{policy?.version === 0 ? t("The displayed defaults are supplied by Navigator and are not persisted until saved.") : t("Changes use the current policy version so stale edits are rejected.")}</p>
        <Button tone="primary" disabled={!mayWrite || !conversationId.trim() || busy !== ""} loading={busy === "policy"}>{t("Save behavior policy")}</Button>
      </form>
    </Panel>
  </div>;
}

function ReviewImportPanel({ api, workspaceId, mayWrite }: { api: NavigatorApi; workspaceId: string; mayWrite: boolean }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<ConversationReviewEvent[]>([]), [eventsError, setEventsError] = useState("");
  const [reviewConversationId, setReviewConversationId] = useState("");
  const [reviewConversationKind, setReviewConversationKind] = useState<ConversationKind>("direct");
  const [reviewMessages, setReviewMessages] = useState<ConversationMessage[]>([]);
  const [reviewSources, setReviewSources] = useState<string[]>([]);
  const [reviewType, setReviewType] = useState<ConversationReviewEvent["eventType"]>("reviewed");
  const [reviewSummary, setReviewSummary] = useState("");
  const [reviewDecision, setReviewDecision] = useState("");
  const [sourceKind, setSourceKind] = useState("aether-export"), [batchId, setBatchId] = useState(newConversationMemoryKey), [recordsJson, setRecordsJson] = useState("[]");
  const [preview, setPreview] = useState<ConversationImportPreview | null>(null), [previewInput, setPreviewInput] = useState("");
  const [previewBatchId, setPreviewBatchId] = useState(""), [previewSourceKind, setPreviewSourceKind] = useState("");
  const [appliedBatch, setAppliedBatch] = useState<ConversationImportResult | null>(null);
  const [rollbackBatchId, setRollbackBatchId] = useState("");
  const [backup, setBackup] = useState<ActorBackupArtifact | null>(null);
  const [backupError, setBackupError] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { let active = true; void api.listConversationReviewEvents(workspaceId, 100).then((items) => { if (active) { setEvents(items); setEventsError(""); } }, (reason) => { if (active) { setEvents([]); setEventsError(errorMessage(reason)); } }); return () => { active = false; }; }, [api, workspaceId, reloadKey]);
  const loadReviewSources = async () => {
    if (!reviewConversationId.trim() || busy) return;
    setBusy("review-sources"); setError("");
    try { const result = await api.getConversationMessages(workspaceId, { conversationId: reviewConversationId.trim(), conversationKind: reviewConversationKind, limit: 100 }); setReviewMessages(result.items); setReviewSources([]); }
    catch (reason) { setError(errorMessage(reason)); setReviewMessages([]); }
    finally { setBusy(""); }
  };
  const appendReviewEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = reviewMessages.filter((message) => reviewSources.includes(message.id) && message.status === "active" && message.scope.conversationId === reviewConversationId.trim() && message.scope.conversationKind === reviewConversationKind);
    if (!mayWrite || !reviewConversationId.trim() || !reviewSummary.trim() || selected.length !== reviewSources.length || !selected.length || selected.some((message) => message.scope.personaId !== selected[0]?.scope.personaId) || busy) return;
    setBusy("review-event"); setError(""); setNotice("");
    try {
      const result = await api.createConversationReviewEvent(workspaceId, { idempotencyKey: newConversationMemoryKey(), eventType: reviewType, conversationId: reviewConversationId.trim(), conversationKind: reviewConversationKind, ...(selected[0]?.scope.personaId ? { personaId: selected[0].scope.personaId } : {}), summary: reviewSummary.trim(), ...(reviewDecision.trim() ? { decision: reviewDecision.trim() } : {}), sourceRefs: selected.map((message) => message.id) });
      setEvents((current) => [result.event, ...current.filter((item) => item.id !== result.event.id)]); setReviewSummary(""); setReviewDecision(""); setReviewSources([]); setNotice(`${t("Review event recorded")}: ${result.event.id}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const parseRecords = (): Record<string, unknown>[] => {
    const value: unknown = JSON.parse(recordsJson);
    if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) throw new Error(t("Import records must be a JSON array of objects."));
    return value as Record<string, unknown>[];
  };
  const previewImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mayWrite || busy || !batchId.trim() || !sourceKind.trim()) return;
    setBusy("preview"); setError(""); setNotice(""); setPreview(null);
    try {
      const result = await api.previewConversationImport(workspaceId, { batchId: batchId.trim(), sourceKind: sourceKind.trim(), records: parseRecords() });
      setPreview(result); setPreviewInput(recordsJson); setPreviewBatchId(batchId.trim()); setPreviewSourceKind(sourceKind.trim()); setNotice(t("Dry-run complete. No imported records were written."));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const applyImport = async () => {
    if (!mayWrite || busy || !preview || previewInput !== recordsJson || previewBatchId !== batchId.trim() || previewSourceKind !== sourceKind.trim() || !window.confirm(t("Apply this previewed import batch? The batch can be rolled back through Navigator."))) return;
    setBusy("apply"); setError(""); setNotice("");
    try {
      const result = await api.applyConversationImport(workspaceId, { batchId: batchId.trim(), sourceKind: sourceKind.trim(), records: parseRecords() });
      setAppliedBatch(result); setRollbackBatchId(result.batchId); setNotice(`${t("Import batch applied")}: ${result.batchId}`); setReloadKey((value) => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const rollbackImport = async () => {
    if (!mayWrite || !rollbackBatchId.trim() || busy || !window.confirm(t("Roll back this import batch?"))) return;
    setBusy("rollback"); setError(""); setNotice("");
    try { const result = await api.rollbackConversationImport(workspaceId, rollbackBatchId.trim()); setNotice(result.rolledBack ? t("Import batch rolled back.") : t("Navigator did not roll back the batch.")); setAppliedBatch(null); setReloadKey((value) => value + 1); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const readImportFile = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setPreview(null); setAppliedBatch(null);
    if (file.size > 10_000_000) { setError(t("Import file exceeds the 10 MB preview limit.")); return; }
    try {
      const text = await file.text();
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) throw new Error(t("Import records must be a JSON array of objects."));
      setRecordsJson(JSON.stringify(value, null, 2)); setPreviewInput("");
    } catch (reason) { setError(errorMessage(reason)); }
  };
  const createBackup = async () => {
    if (!mayWrite || busy) return;
    setBusy("backup"); setError(""); setBackupError(""); setNotice(""); setBackup(null);
    try { const saved = await api.createConversationBackup(workspaceId); setBackup(saved); setNotice(t("Actor-private backup created.")); }
    catch (reason) { setBackupError(errorMessage(reason)); }
    finally { setBusy(""); }
  };
  const downloadBackup = async () => {
    if (!backup || busy) return;
    setBusy("backup-download"); setBackupError("");
    try {
      const blob = await api.downloadConversationBackup(workspaceId, backup.sha256, backup.size);
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `cyrene-actor-backup-${backup.sha256}.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setBackupError(errorMessage(reason)); }
    finally { setBusy(""); }
  };

  return <div className="page-stack">
    <PageHeader eyebrow={t("CONVERSATION ASSISTANT")} title={t("Review & import")} description={t("Read append-only review events and dry-run a bounded actor-scoped import before applying it.")} action={<Button onClick={() => setReloadKey((value) => value + 1)} disabled={busy !== ""}>{t("Refresh")}</Button>} />
    {error && <p role="alert" className="dh-notice dh-notice--danger">{error}</p>}{notice && <p role="status" className="dh-notice">{notice}</p>}
    <div className="conversation-assistant__grid">
      <Panel title={t("Review events")} meta={<span>{events.length}</span>}>
        {eventsError ? <StateBlock kind="error" title={t("Review events unavailable")} detail={eventsError} /> : events.length ? <ul className="conversation-assistant__list">{events.map((item) => <li key={item.id}><div><strong>{item.eventType} · {item.summary}</strong><small>{item.id} · {item.conversationId ?? t("Workspace scope")} · {formatEpoch(item.createdAt, t)}</small><small>{t("Sources")}: {formatSourceRefs(item.sourceRefs) || t("No source references")}</small></div></li>)}</ul> : <StateBlock kind="empty" title={t("No review events")} detail={t("Navigator has not returned review events for this actor.")} />}
        <form className="conversation-assistant__form" onSubmit={appendReviewEvent}>
          <h3>{t("Append a sourced review event")}</h3>
          <div className="conversation-assistant__scope"><label>{t("Conversation ID")}<input value={reviewConversationId} onChange={(event) => setReviewConversationId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><label>{t("Conversation kind")}<select value={reviewConversationKind} onChange={(event) => setReviewConversationKind(event.target.value as ConversationKind)} disabled={!mayWrite || busy !== ""}><option value="direct">{t("Direct")}</option><option value="group">{t("Group")}</option><option value="channel">{t("Channel")}</option></select></label></div>
          <Button type="button" onClick={() => void loadReviewSources()} disabled={!reviewConversationId.trim() || busy !== ""} loading={busy === "review-sources"}>{t("Load review evidence")}</Button>
          {reviewMessages.length > 0 && <div className="conversation-assistant__source-picker">{reviewMessages.filter((message) => message.status === "active").map((message) => <label key={message.id}><input type="checkbox" checked={reviewSources.includes(message.id)} onChange={(event) => setReviewSources((current) => event.target.checked ? [...current, message.id] : current.filter((id) => id !== message.id))} disabled={!mayWrite || busy !== ""} /><span>{message.content}</span><small>{message.id}</small></label>)}</div>}
          <label>{t("Event type")}<select value={reviewType} onChange={(event) => setReviewType(event.target.value as ConversationReviewEvent["eventType"])} disabled={!mayWrite || busy !== ""}><option value="reviewed">{t("Reviewed")}</option><option value="approved">{t("Approved")}</option><option value="rejected">{t("Rejected")}</option><option value="edited">{t("Edited")}</option><option value="rolled_back">{t("Rolled back")}</option><option value="imported">{t("Imported")}</option></select></label>
          <label>{t("Review summary")}<textarea rows={2} value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <label>{t("Decision (optional)")}<input value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)} disabled={!mayWrite || busy !== ""} /></label>
          <Button tone="primary" disabled={!mayWrite || !reviewConversationId.trim() || !reviewSummary.trim() || reviewSources.length === 0 || busy !== ""} loading={busy === "review-event"}>{t("Save review event")}</Button>
        </form>
      </Panel>
      <Panel title={t("Backup & restore")}>
        <p className="conversation-assistant__help">{t("Backup bytes are stored as an actor-private Work artifact. Restoring a full backup is not exposed by the current Navigator API.")}</p>
        {backupError ? <StateBlock kind="error" title={t("Backup unavailable")} detail={backupError} /> : <Button tone="primary" onClick={() => void createBackup()} disabled={!mayWrite || busy !== ""} loading={busy === "backup"}>{t("Create backup")}</Button>}
        {backup && <dl className="conversation-assistant__facts"><dt>{t("Artifact")}</dt><dd>{backup.artifactId} · {backup.size} bytes</dd><dt>{t("SHA-256")}</dt><dd>{backup.sha256}</dd><dt>{t("Format")}</dt><dd>{backup.mimeType}</dd></dl>}
        {backup && <Button onClick={() => void downloadBackup()} disabled={busy !== ""} loading={busy === "backup-download"}>{t("Download backup file")}</Button>}
        <StateBlock kind="error" title={t("Restore endpoint unavailable")} detail={t("Navigator has not exposed a restore preview/apply/rollback route. The backup artifact remains downloadable; no restore is claimed.")} />
      </Panel>
    </div>
    <Panel title={t("Offline import dry-run")}>
      <form className="conversation-assistant__form" onSubmit={(event) => void previewImport(event)}>
        <label>{t("Batch ID")}<input value={batchId} onChange={(event) => { setBatchId(event.target.value); setPreview(null); setAppliedBatch(null); }} disabled={!mayWrite || busy !== ""} /></label>
        <label>{t("Source kind")}<input value={sourceKind} onChange={(event) => { setSourceKind(event.target.value); setPreview(null); setAppliedBatch(null); }} disabled={!mayWrite || busy !== ""} /></label>
        <label>{t("Load offline JSON export")}<input type="file" accept="application/json,.json" onChange={(event) => void readImportFile(event.target.files?.[0])} disabled={!mayWrite || busy !== ""} /></label>
        <label>{t("Import records JSON")}<textarea rows={12} value={recordsJson} onChange={(event) => { setRecordsJson(event.target.value); setPreview(null); setAppliedBatch(null); }} disabled={!mayWrite || busy !== ""} /></label>
        <p className="conversation-assistant__help">{t("Preview returns counts and a digest only. The source must include exact source references; untrusted or unsupported data is quarantined by Navigator.")}</p>
        <Button tone="primary" disabled={!mayWrite || !batchId.trim() || !sourceKind.trim() || busy !== ""} loading={busy === "preview"}>{t("Preview import")}</Button>
      </form>
      {preview && <div className="conversation-assistant__import-preview"><h3>{t("Import preview")}</h3><dl className="conversation-assistant__facts"><dt>{t("Records")}</dt><dd>{preview.recordCount}</dd><dt>{t("Accepted")}</dt><dd>{preview.acceptedCount}</dd><dt>{t("Quarantined")}</dt><dd>{preview.quarantinedCount}</dd><dt>{t("Digest")}</dt><dd>{preview.digest}</dd></dl><div className="conversation-assistant__actions"><Button tone="primary" onClick={() => void applyImport()} disabled={!mayWrite || busy !== "" || previewInput !== recordsJson || previewBatchId !== batchId.trim() || previewSourceKind !== sourceKind.trim()} loading={busy === "apply"}>{t("Apply import")}</Button></div></div>}
      {appliedBatch && <div><StatusPill value="applied" /><p>{appliedBatch.batchId} · {t("Imported")}: {appliedBatch.importedCount} · {t("Quarantined")}: {appliedBatch.quarantinedCount}</p></div>}
      <div className="conversation-assistant__inline-read"><label>{t("Rollback batch ID")}<input value={rollbackBatchId} onChange={(event) => setRollbackBatchId(event.target.value)} disabled={!mayWrite || busy !== ""} /></label><Button tone="danger" onClick={() => void rollbackImport()} disabled={!mayWrite || !rollbackBatchId.trim() || busy !== ""}>{t("Rollback import")}</Button></div>
    </Panel>
  </div>;
}

function formatEpoch(value: number | null, translate: (message: string) => string): string {
  if (value === null || !Number.isFinite(value)) return translate("Not set");
  const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatSourceRefs(refs: ConversationSourceReference[]): string {
  return refs.map((ref) => {
    const memory = ref.memoryId ? `${ref.memoryId} v${ref.memoryVersion}` : "";
    const messages = ref.sourceMessageIds.join(", ");
    return [memory, messages].filter(Boolean).join(" → ");
  }).filter(Boolean).join(" · ");
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
