import { resolve } from "node:path";
import type { Plugin, Connect } from "vite";
import { PipelineControl, pipelineDatabase, emptyPipelineDatabase } from "../packages/pipeline-control/service";
import { pipelineCommands } from "../packages/pipeline-control/contracts";
import { AtomicJsonStore } from "./server-store";
import { controlMiddleware } from "./server-control";

export function createPipelineControl(directory = resolve(".studio")) {
  return new PipelineControl(new AtomicJsonStore(resolve(directory, "pipelines.json"), pipelineDatabase, emptyPipelineDatabase));
}
export function pipelineControlBridge(directory?: string): Plugin {
  const install = (server: { middlewares: Connect.Server }) => {
    server.middlewares.use(controlMiddleware(createPipelineControl(directory), {
      prefix: "/studio-pipelines", commands: pipelineCommands, scopes: ["pipelines.read", "pipelines.write"], maxBytes: 1_048_576,
    }));
  };
  return { name: "cyrene-pipeline-control", configureServer: install, configurePreviewServer: install };
}
