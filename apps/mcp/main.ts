import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPipelineControl } from "../../tooling/pipeline-control";
import { createMcpServer } from "./server";
import { RemoteControl } from "../../packages/control-client";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = process.env.STUDIO_CONTROL_DATA_DIR ? resolve(root, process.env.STUDIO_CONTROL_DATA_DIR) : resolve(root, ".studio");
const write = process.env.STUDIO_MCP_READ_ONLY !== "1";
const control = process.env.STUDIO_CONTROL_URL
  ? new RemoteControl(process.env.STUDIO_CONTROL_URL, process.env.STUDIO_API_TOKEN ?? "")
  : createPipelineControl(directory);
if (!process.env.STUDIO_CONTROL_URL) process.stderr.write("Legacy file-backed MCP mode; deployed workspaces must set STUDIO_CONTROL_URL and STUDIO_API_TOKEN.\n");
const actor = control instanceof RemoteControl ? await control.session() : {
  id: "local-mcp", workspaceIds: ["local"], scopes: ["pipelines.read", "runs.read", ...(write ? ["pipelines.write", "runs.write"] : [])],
};
const remote = (prefix: string) => process.env.STUDIO_CONTROL_URL ? new RemoteControl(process.env.STUDIO_CONTROL_URL, process.env.STUDIO_API_TOKEN ?? "", prefix) : undefined;
const server = createMcpServer(control, actor, remote("/studio-runs"), { builds: remote("/studio-builds"), catalog: remote("/studio-catalog"), servers: remote("/studio-control"), readOnly: !write });
await server.connect(new StdioServerTransport());
