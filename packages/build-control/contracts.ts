import { z } from "zod";
import { identifier } from "../server-control/contracts";
import { packageSchema } from "../node-registry/contracts";

export const imageDigest = z.string().regex(/^[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
export const sourceSha = z.string().regex(/^[a-f0-9]{40}$/);
export const buildProfile = z.object({
  id: identifier, title: z.string().min(1).max(120), workspaceIds: z.array(identifier).min(1),
  owner: z.string().regex(/^[A-Za-z0-9-]+$/), repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  workflow: z.string().regex(/^[A-Za-z0-9_.-]+\.ya?ml$/), workflowRef: z.string().min(1).max(200),
  sourceRefs: z.array(z.string().min(1).max(200)).min(1).max(50),
  imageRepository: z.string().regex(/^[a-z0-9][a-z0-9./_-]+$/), packageId: z.string().min(1).max(100),
}).strict();
export type BuildProfile = z.infer<typeof buildProfile>;
export const buildResult = z.object({
  schemaVersion: z.literal("cyrene.studio.build-result.v1"), buildId: identifier,
  profileId: identifier, sourceRepository: z.string(), sourceSha,
  workflowRunId: z.string().regex(/^\d+$/), image: imageDigest, package: packageSchema,
  provenance: z.object({ workflowSha: sourceSha, dependencyDigests: z.record(z.string().min(1).max(500), z.string().regex(/^sha256:[a-f0-9]{64}$/)).refine(value => Object.keys(value).length > 0) }).strict(),
}).strict();
export type BuildResult = z.infer<typeof buildResult>;
export const buildRecord = z.object({
  id: identifier, workspaceId: identifier, createdBy: identifier, createdAt: z.string().datetime(), revision: z.number().int().positive(),
  profile: buildProfile, sourceRef: z.string(), sourceSha, workflowSha: sourceSha,
  state: z.enum(["queued", "dispatching", "running", "unknown", "cancelling", "cancelled", "succeeded", "failed"]),
  workflowRunId: z.string().optional(), workflowUrl: z.string().optional(), result: buildResult.optional(),
  message: z.string().optional(),
});
export type Build = z.infer<typeof buildRecord>;
export const buildEvent = z.object({ sequence: z.number().int().positive(), buildId: identifier, workspaceId: identifier, at: z.string().datetime(), message: z.string() });
export const buildDatabase = z.object({ version: z.literal(1), builds: z.array(buildRecord), events: z.array(buildEvent), receipts: z.array(z.object({ key: z.string(), fingerprint: z.string(), buildId: identifier })) });
export type BuildDatabase = z.infer<typeof buildDatabase>;
export const emptyBuildDatabase = (): BuildDatabase => ({ version: 1, builds: [], events: [], receipts: [] });
const workspace = z.object({ workspaceId: identifier }).strict(), target = workspace.extend({ buildId: identifier });
const preview = workspace.extend({ profileId: identifier, sourceRef: z.string().min(1).max(200) });
export const buildCommands = {
  "builds.list_profiles": { input: workspace, output: z.object({ items: z.array(buildProfile) }), readOnly: true, scope: "builds.read", description: "列出管理员配置的节点构建来源、允许的源码引用与镜像仓库。" },
  "builds.preview": { input: preview, output: z.object({ profile: buildProfile, sourceSha, workflowSha: sourceSha, fingerprint: z.string() }), readOnly: true, scope: "builds.read", description: "解析源码 SHA 并预览构建，不触发 GitHub Actions。" },
  "builds.start": { input: preview.extend({ expectedFingerprint: z.string().length(64) }), output: buildRecord, readOnly: false, scope: "builds.write", description: "按预览结果提交节点镜像构建；源码变化时拒绝，不自动启用版本。" },
  "builds.list": { input: workspace, output: z.object({ items: z.array(buildRecord) }), readOnly: true, scope: "builds.read", description: "列出工作空间的构建与构建结果。" },
  "builds.get": { input: target, output: buildRecord, readOnly: true, scope: "builds.read", description: "读取构建状态、GitHub 关联和已验证的镜像摘要。" },
  "builds.cancel": { input: target.extend({ expectedRevision: z.number().int().positive() }), output: buildRecord, readOnly: false, scope: "builds.write", description: "取消构建；以 GitHub 最终状态为准，不删除已发布镜像。" },
  "builds.read_events": { input: target.extend({ after: z.number().int().nonnegative().default(0) }), output: z.object({ items: z.array(buildEvent), cursor: z.number() }), readOnly: true, scope: "builds.read", description: "按游标读取持久化构建事件；GitHub 实时输出通过运行链接查看。" },
} as const;
