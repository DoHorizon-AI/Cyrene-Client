// ┌─────────────────────────────────────────────────────────────────────┐
// │  📄 UpdatesPanel.tsx                                                 │
// │  Module: apps/web/updates                                            │
// │  Role: Show update status, stage downloads, and confirm local apply.  │
// │                                                                      │
// │  模块职责：展示更新、下载暂存，并由用户确认本机安装。                    │
// └─────────────────────────────────────────────────────────────────────┘
import { useEffect, useRef, useState } from "react";
import { updateHelperResultSchema, type UpdateHelperResult, type UpdatePlan } from "../../../../packages/component-updates/contracts";
import { controlCommand } from "../services/commands";
import { useI18n } from "../i18n";

const UPDATE_PREFIX = "/studio-updates";

function stagedPlans(result: UpdateHelperResult | null): UpdatePlan[] {
  if (!result) return [];
  return [...(result.plans ?? []), ...(result.plan ? [result.plan] : [])]
    .filter((plan, index, plans) => plan.phase === "staged" && plans.findIndex(candidate => candidate.planId === plan.planId) === index);
}

/** Poll update status, stage safe downloads, and require a digest-bound confirmation to apply. */
export function UpdatesPanel({ onReminderChange }: { onReminderChange?: (count: number) => void }) {
  const { locale } = useI18n();
  const tx = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [result, setResult] = useState<UpdateHelperResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(tx("正在检查组件更新…", "Checking component updates…"));
  const [error, setError] = useState("");
  const refreshInFlight = useRef(false);
  const checkInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function refreshStatus() {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const status = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.status", {}));
        if (mounted) { setResult(status); onReminderChange?.(reminderCount(status)); }
        if (mounted && status.status === "unconfigured") setMessage(tx("更新服务尚未配置可信组件目录。", "The updater has no pinned trusted component catalog yet."));
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setMessage(tx("无法读取本机更新状态。", "Local update status is unavailable."));
        }
      } finally { refreshInFlight.current = false; }
    }

    async function checkAndStage() {
      if (checkInFlight.current) return;
      checkInFlight.current = true;
      if (mounted) { setBusy(true); setError(""); }
      try {
        const status = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.check", {}));
        const stagedCount = await stageCheckedPlans(status);
        const latest = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.status", {}));
        if (mounted) {
          setResult(latest);
          onReminderChange?.(reminderCount(latest));
          setMessage(stagedCount
            ? tx(`已自动下载并暂存 ${stagedCount} 个更新计划；应用前会逐项确认计划 digest。`, `${stagedCount} update plan(s) were downloaded and staged. Each plan digest requires explicit confirmation before apply.`)
            : latest.status === "unconfigured"
              ? tx("更新服务尚未配置可信组件目录。", "The updater has no pinned trusted component catalog yet.")
              : tx("已检查组件版本。", "Component versions are checked."));
        }
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setMessage(tx("检查或暂存更新失败。", "Checking or staging updates failed."));
        }
      } finally {
        checkInFlight.current = false;
        if (mounted) setBusy(false);
      }
    }

    void refreshStatus();
    void checkAndStage();
    const statusTimer = window.setInterval(() => void refreshStatus(), 15_000);
    const checkTimer = window.setInterval(() => void checkAndStage(), 5 * 60_000);
    return () => { mounted = false; window.clearInterval(statusTimer); window.clearInterval(checkTimer); };
  }, [locale, onReminderChange]);

  async function stageCheckedPlans(checked: UpdateHelperResult): Promise<number> {
    let stagedCount = 0;
    const plans = [...(checked.plans ?? []), ...(checked.plan ? [checked.plan] : [])];
    for (const plan of plans) {
      if (plan.phase !== "checked" || plan.components.length === 0) continue;
      const stageable = plan.components.every(target => {
        const component = checked.components.find(item => item.componentId === target.componentId);
        return !!component && component.supported && component.allowedActions.includes("stage");
      });
      if (stageable) {
        await controlCommand<unknown>(UPDATE_PREFIX, "updates.stage", { planId: plan.planId, planDigest: plan.planDigest, channel: plan.channel }, crypto.randomUUID(), 15 * 60_000);
        stagedCount += 1;
      }
    }
    return stagedCount;
  }

  async function checkNow() {
    if (busy || checkInFlight.current) return;
    checkInFlight.current = true;
    setBusy(true); setError("");
    try {
      const checked = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.check", { channel: "stable" }));
      const stagedCount = await stageCheckedPlans(checked);
      const latest = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.status", {}));
      setResult(latest);
      onReminderChange?.(reminderCount(latest));
      setMessage(stagedCount
        ? tx(`已下载并暂存 ${stagedCount} 个更新；每个目标需要单独确认。`, `${stagedCount} update(s) were downloaded and staged. Confirm each target separately.`)
        : latest.status === "unconfigured"
          ? tx("更新服务尚未配置可信组件目录。", "The updater has no pinned trusted component catalog yet.")
          : tx("已检查组件版本。", "Component versions are checked."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMessage(tx("检查更新失败。", "The update check failed."));
    } finally { checkInFlight.current = false; setBusy(false); }
  }

  async function apply(plan: UpdatePlan) {
    if (busy || !canApplyPlan(plan, result)) return;
    setBusy(true); setError("");
    let fresh: UpdateHelperResult;
    try {
      fresh = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.status", {}));
      setResult(fresh);
      onReminderChange?.(reminderCount(fresh));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMessage(tx("无法确认最新运行状态；没有应用更新。", "The latest runtime state could not be confirmed. No update was applied."));
      setBusy(false);
      return;
    }
    if (!canApplyPlan(plan, fresh)) {
      setMessage(tx("运行状态或计划已变化；应用已禁用，请重新检查。", "Runtime readiness or the plan changed. Apply is disabled; check again."));
      setBusy(false);
      return;
    }
    const names = plan.components.map(component => `${component.componentId}@${component.version}`).join("\n");
    const confirmation = tx(
      `确认只更新以下目标组件？\n${names}\n\nChannel: ${plan.channel}\nPlan ID: ${plan.planId}\nPlan digest: ${plan.planDigest}\n\n运行任务不会被取消或排空。`,
      `Apply updates to only these components?\n${names}\n\nChannel: ${plan.channel}\nPlan ID: ${plan.planId}\nPlan digest: ${plan.planDigest}\n\nRunning tasks will not be cancelled or drained.`,
    );
    if (!window.confirm(confirmation)) { setBusy(false); return; }

    try {
      const applied = updateHelperResultSchema.parse(await controlCommand<unknown>(UPDATE_PREFIX, "updates.apply", {
        planId: plan.planId,
        planDigest: plan.planDigest,
        channel: plan.channel,
        confirmation: { planId: plan.planId, planDigest: plan.planDigest, confirmed: true },
      }, crypto.randomUUID(), 15 * 60_000));
      setResult(applied);
      onReminderChange?.(reminderCount(applied));
      setMessage(tx("本机已接受更新操作。", "The local updater accepted the request."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMessage(tx("更新未获准或未完成；请先重新读取状态。", "The update was blocked or did not complete. Read status before retrying."));
    } finally { setBusy(false); }
  }

  const plans = stagedPlans(result);

  return <div className="keep-menu-open updates-menu-content" aria-label={tx("组件更新", "Component updates")}>
    <div className="updates-heading"><strong>{tx("组件更新", "Component updates")}</strong><button disabled={busy} onClick={() => void checkNow()}>{busy ? tx("检查中…", "Checking…") : tx("检查更新", "Check updates")}</button></div>
    <p role="status">{message}</p>
    {error && <p className="updates-error" role="alert">{error}</p>}
    {result?.components.length ? <div className="updates-components">{result.components.map(component => {
      const waiting = component.gate.state !== "idle" || component.gate.gateGeneration === undefined || component.gate.gateGeneration === null;
      return <article className="updates-component" key={component.componentId}>
        <div><strong>{component.componentId}</strong><small>{component.supported ? component.phase : tx("此平台不支持", "Unsupported on this platform")}</small></div>
        <p>{component.installed ? `${tx("当前", "Current")}: ${component.activeVersion ?? tx("版本未知", "version unknown")}` : tx("尚未安装", "Not installed")}{component.availableVersion ? ` · ${tx("可用", "Available")}: ${component.availableVersion}` : ""}{component.stagedVersion ? ` · ${tx("已暂存", "Staged")}: ${component.stagedVersion}` : ""}</p>
        {(component.gate.state !== "idle" || component.blockers.length > 0) && <p className="updates-blocker">{[...component.blockers, ...component.gate.blockers].map(blocker => blocker.message).join(" · ") || component.gate.blockerCodes.join(", ") || component.gate.state}</p>}
        {!component.supported && <p className="updates-muted">{tx("Windows 原生更新目标暂未开放。", "Native Windows update targets are not available yet.")}</p>}
        {component.supported && waiting && component.updateAvailable && <p className="updates-muted">{tx("更新包可以下载；当前忙碌状态或状态源不可用时不能安装。", "The update can be downloaded. Applying is disabled while busy or when a status source is unavailable.")}</p>}
      </article>;
    })}</div> : <p className="updates-muted">{tx("暂无可显示的更新目标。", "No update targets are available to display.")}</p>}
    {plans.map(plan => {
      const canApply = canApplyPlan(plan, result);
      const target = plan.components[0]?.componentId;
      return <section className="updates-plan" key={plan.planId}>
        <p>{tx("已暂存计划", "Staged plan")} · {target ?? plan.planId}</p>
        <code>{plan.planDigest}</code>
        <button className="primary" disabled={busy || !canApply} onClick={() => void apply(plan)}>{busy ? tx("处理中…", "Working…") : tx("确认并应用此目标", "Confirm and apply this target")}</button>
        {!canApply && <small>{tx("仅当维护来源确认 idle 且本机仍允许该计划时可应用。", "Apply is available only when the maintenance source reports idle and the local helper permits this plan.")}</small>}
      </section>;
    })}
  </div>;
}

function reminderCount(result: UpdateHelperResult): number {
  return Math.max(stagedPlans(result).length, result.components.filter(component => component.updateAvailable).length);
}

function canApplyPlan(plan: UpdatePlan, result: UpdateHelperResult | null): boolean {
  if (plan.phase !== "staged" || plan.components.length < 1) return false;
  return plan.components.every(target => {
    const component = result?.components.find(item => item.componentId === target.componentId);
    const gate = component?.gate;
    return !!component && component.supported && gate?.state === "idle"
      && gate.gateGeneration !== undefined && gate.gateGeneration !== null
      && (gate.activeTaskCount ?? 0) === 0 && gate.activeTasks.length === 0
      && (gate.inflightRuntimeAdmissionCount ?? 0) === 0 && gate.unknownActivitySources.length === 0
      && component.allowedActions.includes("apply");
  });
}
