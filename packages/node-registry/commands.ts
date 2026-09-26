import { z } from "zod";
import { identifier } from "../server-control/contracts";
import { packageSchema } from "./contracts";

const workspace = z.object({ workspaceId: identifier }).strict();
const activation = workspace.extend({ buildId: identifier, expectedRevision: z.number().int().nonnegative() });
export const activationPreview = z.object({ fingerprint: z.string(), revision: z.number().int().nonnegative(), package: packageSchema, replacing: z.array(z.string()) });
export const catalogCommands = {
  "catalog.list_packages": { input: workspace, output: z.object({ revision: z.number(), packages: z.array(packageSchema), active: z.array(z.string()), updatedBy: z.string() }), readOnly: true, scope: "pipelines.read", description: "查询节点包、历史版本及当前启用版本。" },
  "catalog.preview_activation": { input: activation, output: activationPreview, readOnly: true, scope: "catalog.write", description: "预览已验证构建的版本启用，检查契约冲突；不修改目录。" },
  "catalog.activate": { input: activation.extend({ expectedFingerprint: z.string().length(64) }), output: z.object({ revision: z.number(), packageId: z.string(), version: z.string() }), readOnly: false, scope: "catalog.write", description: "显式启用已预览的新节点版本，保留旧文档和运行的固定版本。" },
} as const;
