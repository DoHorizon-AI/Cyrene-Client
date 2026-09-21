import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createPipelineControl } from "../../tooling/pipeline-control";
import { createMcpServer } from "./server";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = process.env.STUDIO_CONTROL_DATA_DIR ? resolve(root, process.env.STUDIO_CONTROL_DATA_DIR) : resolve(root, ".studio");
const write = process.env.STUDIO_MCP_READ_ONLY !== "1";
const server = createMcpServer(createPipelineControl(directory), {
  id: "local-mcp", workspaceIds: ["local"], scopes: ["pipelines.read", ...(write ? ["pipelines.write"] : [])],
});
await server.connect(new StdioServerTransport());
