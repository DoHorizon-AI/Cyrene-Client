// -----------------------------------------------------------------------------
// Module: src/components.tsx
// Role: Shared presentation primitives for the Navigator operations console.
// -----------------------------------------------------------------------------
// 中文：// 中文：模块职责：为 Navigator 运维控制台提供共享展示组件。

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { useI18n } from "./i18n";

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * Page-level title block with a single clear action slot.
 * 提供页面级标题区，并预留一个明确的操作按钮位置。
 */
export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{t(eyebrow)}</p>
        <h1>{t(title)}</h1>
        <p className="page-description">{t(description)}</p>
      </div>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}

export interface PanelProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Bordered work surface used to keep related API data together.
 * 使用带边框的工作区将相关 API 数据归在一起。
 */
export function Panel({ title, meta, children, className = "", id }: PanelProps) {
  const { t } = useI18n();
  return (
    <section className={`panel ${className}`.trim()} id={id}>
      <div className="panel__heading">
        <h2>{t(title)}</h2>
        {meta ? <div className="panel__meta">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "primary" | "quiet" | "danger";
  /**
   * Shows the shared busy marker and sets aria-busy; callers still own `disabled`.
   * 显示统一的处理中标记并设置 aria-busy；是否禁用仍由调用方决定。
   */
  loading?: boolean;
}

/**
 * Consistent keyboard-focusable button surface.
 * 提供统一且可通过键盘聚焦的按钮外观。
 */
export function Button({ tone = "quiet", className = "", loading = false, children, ...props }: ButtonProps) {
  const { t } = useI18n();
  return (
    <button className={`button button--${tone} ${className}`.trim()} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="button__spinner" aria-hidden="true" /> : null}
      {typeof children === "string" ? t(children) : children}
    </button>
  );
}

/** `info` is a steady (non-animated) informational tone and is only set explicitly. */
export type StatusTone = "good" | "live" | "info" | "warn" | "bad" | "muted";

/**
 * Map a raw (untranslated) lifecycle state to its semantic tone.
 * 将原始（未翻译）生命周期状态映射为语义色调。
 */
export function statusTone(value: string | undefined): StatusTone {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized || normalized.includes("inactive") || normalized.includes("not ready")) return "muted";
  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("revoked") ||
    normalized.includes("unhealthy") ||
    normalized.includes("rejected") ||
    normalized.includes("denied") ||
    normalized === "unavailable" ||
    normalized === "blocked"
  ) return "bad";
  if (
    normalized.includes("stale") ||
    normalized.includes("out of date") ||
    normalized.includes("interrupted") ||
    normalized.includes("cancel") ||
    normalized.includes("skipped") ||
    normalized.includes("expired") ||
    normalized.includes("degraded") ||
    normalized.includes("warning") ||
    normalized === "offline"
  ) return "warn";
  if (
    normalized.includes("running") ||
    normalized.includes("start") ||
    normalized.includes("validat") ||
    normalized.includes("queued") ||
    normalized.includes("processing") ||
    normalized.includes("loading") ||
    normalized.includes("probing") ||
    normalized.includes("connecting") ||
    normalized === "live"
  ) return "live";
  if (
    normalized.includes("ready") ||
    normalized.includes("active") ||
    normalized.includes("complete") ||
    normalized.includes("published") ||
    normalized.includes("succeeded") ||
    normalized.includes("success") ||
    normalized.includes("approved") ||
    normalized.includes("evaluated") ||
    normalized.includes("passed") ||
    normalized === "current" ||
    normalized === "connected" ||
    normalized === "finished" ||
    normalized === "up" ||
    normalized === "available" ||
    normalized === "mounted" ||
    normalized === "ok"
  ) return "good";
  return "muted";
}

/**
 * Small state marker that uses domain wording rather than color alone.
 * Pass `tone` when the visible label is translated or not a raw state.
 * 使用领域术语呈现小型状态标记，不单靠颜色表达状态；显示文字已翻译时请显式传入 tone。
 */
export function StatusPill({ value, tone }: { value: string | undefined; tone?: StatusTone }) {
  const { t } = useI18n();
  const label = value || "UNKNOWN";
  return <span className={`status-pill status-pill--${tone ?? statusTone(label)}`}>{t(label)}</span>;
}

export type WorkflowStepState = "done" | "current" | "running" | "attention" | "blocked" | "pending";

export interface WorkflowStep {
  id: string;
  label: string;
  detail?: string;
  state: WorkflowStepState;
  /** Element id to scroll to when the step label is activated. 中文：点击步骤时滚动到的元素 id。 */
  targetId?: string;
}

/**
 * Horizon-style workflow progress: hairline track, gradient fill to the
 * furthest reached step, hollow diamonds for finished steps.
 * Labels and details must already be localized.
 * 地平线式流程进度：细线轨道、渐变填充到已到达的最远步骤、空心菱形表示已完成；文案需已本地化。
 */
export function WorkflowSteps({ steps, label }: { steps: readonly WorkflowStep[]; label: string }) {
  const hasFocus = steps.some((step) => step.state === "current" || step.state === "running" || step.state === "blocked");
  const firstPending = hasFocus ? -1 : steps.findIndex((step) => step.state === "pending");
  const resolved = steps.map((step, index) => index === firstPending ? { ...step, state: "current" as const } : step);
  const reached = resolved.reduce((furthest, step, index) => step.state === "pending" ? furthest : index, 0);
  const style = { "--dh-steps-count": resolved.length, "--dh-steps-progress": reached } as CSSProperties;
  const reveal = (targetId: string) => {
    document.getElementById(targetId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <ol className="dh-steps" aria-label={label} style={style}>
      {resolved.map((step, index) => {
        const mix = reached > 0 ? Math.round((Math.min(index, reached) / reached) * 100) : 0;
        const active = step.state === "current" || step.state === "running";
        return (
          <li
            key={step.id}
            className="dh-step"
            data-state={step.state}
            aria-current={active ? "step" : undefined}
            style={{ "--dh-step-mix": `${mix}%` } as CSSProperties}
          >
            <span className="dh-step__node" aria-hidden="true" />
            <span className="dh-step__label">
              {step.targetId ? (
                <button type="button" className="dh-step__link" onClick={() => reveal(step.targetId!)}>{step.label}</button>
              ) : step.label}
            </span>
            {step.detail ? <span className="dh-step__detail">{step.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  detail: string;
  accent?: "lime" | "orange" | "blue" | "gray";
}

/**
 * Compact metric with an editorial label/detail hierarchy.
 * 采用清晰的标题与详情层级展示紧凑指标。
 */
export function MetricCard({ label, value, detail, accent = "lime" }: MetricCardProps) {
  const { t } = useI18n();
  return (
    <article className={`metric-card metric-card--${accent}`}>
      <p className="metric-card__label">{t(label)}</p>
      <strong>{value}</strong>
      <p className="metric-card__detail">{t(detail)}</p>
    </article>
  );
}

export interface StateBlockProps {
  kind: "loading" | "error" | "empty";
  title: string;
  detail: string;
  action?: ReactNode;
}

/**
 * Honest loading, failure, and empty states shared by every resource page.
 * 为所有资源页面提供一致的加载、失败和空状态。
 */
export function StateBlock({ kind, title, detail, action }: StateBlockProps) {
  const { t } = useI18n();
  return (
    <div className={`state-block state-block--${kind}`} role={kind === "error" ? "alert" : undefined}>
      <span className="state-block__mark" aria-hidden="true">
        {kind === "loading" ? "..." : kind === "error" ? "!" : "0"}
      </span>
      <div>
        <h3>{t(title)}</h3>
        <p>{t(detail)}</p>
        {action ? <div className="state-block__action">{action}</div> : null}
      </div>
    </div>
  );
}

export interface TableColumn<T> {
  label: string;
  className?: string;
  render: (row: T) => ReactNode;
}

export interface ResourceTableProps<T> {
  rows: readonly T[];
  columns: readonly TableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  caption: string;
}

/**
 * Accessible horizontal table with a mobile scroll boundary.
 * 提供可访问的水平表格，并在移动端设置滚动边界。
 */
export function ResourceTable<T>({ rows, columns, rowKey, caption }: ResourceTableProps<T>) {
  const { t } = useI18n();
  return (
    <div className="table-scroll">
      <table className="resource-table">
        <caption>{t(caption)}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th className={column.className} key={column.label} scope="col">
                {t(column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td className={column.className} key={column.label}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Form label wrapper that keeps the control name adjacent to its input.
 * 提供表单标签包装组件，使控件名称紧邻对应输入框。
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span className="field__label">{t(label)}</span>
      {children}
      {hint ? <span className="field__hint">{t(hint)}</span> : null}
    </label>
  );
}

/**
 * Format an optional API timestamp for the operator's local timezone.
 * 按操作人员本地时区格式化可选的 API 时间戳。
 */
export function formatDate(value: unknown): string {
  const locale = typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
  if (typeof value !== "string" || !value) {
    return locale === "zh-CN" ? "无时间戳" : "No timestamp";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Narrow an unknown Product field to a render-safe string.
 * 将未知 Product 字段收窄为可安全渲染的字符串。
 */
export function text(value: unknown, fallback = "Not reported"): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

/**
 * Format a count without hiding the unavailable state behind zero.
 * 格式化计数，同时不把不可用状态伪装成零。
 */
export function count(value: number | null): string {
  return value === null ? "--" : new Intl.NumberFormat().format(value);
}
