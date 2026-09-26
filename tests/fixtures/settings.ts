// Isolated API fixtures, never presented as a running Product environment.
// 这些 API fixture 相互隔离，不会被呈现为正在运行的 Product 环境。
export const ids = {
  dataset: "11111111-1111-4111-8111-111111111111",
  version: "22222222-2222-4222-8222-222222222222",
  model: "33333333-3333-4333-8333-333333333333",
  draft: "44444444-4444-4444-8444-444444444444",
  suite: "55555555-5555-4555-8555-555555555555",
};
export const artifact = { uri: `artifact://sha256/${"a".repeat(64)}`, digest: `sha256:${"a".repeat(64)}`, manifest_digest: `sha256:${"a".repeat(64)}`, size_bytes: 100, kind: "model" };
export const hostStatus = {
  service: "cyrene-navigator-web-host", status: "ok", authenticated: true,
  proxyPrefixes: ["catalyst", "reactor", "yield", "echo", "navigator"].map((s) => `/api/v1/${s}`),
  observedAt: "2026-09-21T00:00:00Z", gpu: { available: true, gpus: [{ name: "Fixture GPU", totalMib: 24576, usedMib: 0, utilizationPct: 0 }] },
};
export const authSession = { authenticated: true, refreshable: true, csrfToken: "fixture-csrf" };
export const draft = {
  id: ids.draft, name: "Fixture LoRA draft", state: "PREPARED", trainingRun: null,
  datasetVersion: { id: ids.version, uri: `cyrene://catalyst/dataset-versions/${ids.version}`, resourceVersion: 1, artifact: { ...artifact, kind: "dataset" } },
  configuration: { baseModel: { artifact, source: { repository: "example/base-model", revision: "b".repeat(40) } },
    parameters: { epochs: 2, learningRate: 0.0001, perDeviceBatchSize: 2, gradientAccumulationSteps: 4, maxSequenceLength: 1024, maxSteps: 20, loraRank: 16, loraAlpha: 32, loraDropout: 0.1, template: "default" } },
};
export const suite = { id: ids.suite, name: "Fixture evaluation", evaluator: "exact_match.v1", expectedField: "expected", actualField: "actual", threshold: 0.85, judgeProfileId: null, state: "ACTIVE", resourceVersion: 1 };
export const version = { id: ids.version, datasetId: ids.dataset, version: 1, state: "PUBLISHED", resourceVersion: 1, output: { ...artifact, kind: "dataset" }, rowCount: 500 };
export const models = [{ id: ids.model, name: "Fixture base model", state: "READY", servingBindingId: "fixture-binding", modelArtifact: artifact, source: { kind: "HUGGING_FACE", repository: "example/base-model", revision: "b".repeat(40) }, credentialRef: "must-not-enter-pipeline" }];
export const sessions = { items: [{ revision: "r1", eventCount: 12, productMetadata: { workspaceId: "workspace-one", sessionId: "session-one", ownerState: "known" }, meta: { title: "private-not-in-settings" } }] };
