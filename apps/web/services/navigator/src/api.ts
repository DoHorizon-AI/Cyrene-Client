// Compatibility facade: all product clients share this single session transport.
import { NavigatorTransport } from "./api/transport";
import { HostApi } from "./api/host";
import { ModelsApi } from "./api/models";
import { DatasetsApi } from "./api/datasets";
import { TrainingApi } from "./api/training";
import { DeploymentApi } from "./api/deployment";
import { ExchangeApi } from "./api/exchange";
import { AssistantApi } from "./api/assistant";
import { WorkApi } from "./api/work";

export * from "./api/types";
export * from "./api/errors";
export { NAVIGATOR_PROXY_PATHS } from "./api/constants";
export { makeIdempotencyKey } from "./api/requests";

export class NavigatorApi extends NavigatorTransport {
  private readonly hostApi = new HostApi(this);
  private readonly modelsApi = new ModelsApi(this);
  private readonly datasetsApi = new DatasetsApi(this);
  private readonly trainingApi = new TrainingApi(this);
  private readonly deploymentApi = new DeploymentApi(this);
  private readonly exchangeApi = new ExchangeApi(this);
  private readonly assistantApi = new AssistantApi(this);
  private readonly workApi = new WorkApi(this);

  getSystemStatus(...args: Parameters<HostApi["getSystemStatus"]>): ReturnType<HostApi["getSystemStatus"]> {
    return this.hostApi.getSystemStatus(...args);
  }

  getCredentials(...args: Parameters<HostApi["getCredentials"]>): ReturnType<HostApi["getCredentials"]> {
    return this.hostApi.getCredentials(...args);
  }

  createCredential(...args: Parameters<HostApi["createCredential"]>): ReturnType<HostApi["createCredential"]> {
    return this.hostApi.createCredential(...args);
  }

  revokeCredential(...args: Parameters<HostApi["revokeCredential"]>): ReturnType<HostApi["revokeCredential"]> {
    return this.hostApi.revokeCredential(...args);
  }

  requestProductResponse(...args: Parameters<HostApi["requestProductResponse"]>): ReturnType<HostApi["requestProductResponse"]> {
    return this.hostApi.requestProductResponse(...args);
  }

  getModelImports(...args: Parameters<ModelsApi["getModelImports"]>): ReturnType<ModelsApi["getModelImports"]> {
    return this.modelsApi.getModelImports(...args);
  }

  getServingBindings(...args: Parameters<ModelsApi["getServingBindings"]>): ReturnType<ModelsApi["getServingBindings"]> {
    return this.modelsApi.getServingBindings(...args);
  }

  createModelImport(...args: Parameters<ModelsApi["createModelImport"]>): ReturnType<ModelsApi["createModelImport"]> {
    return this.modelsApi.createModelImport(...args);
  }

  getDatasets(...args: Parameters<DatasetsApi["getDatasets"]>): ReturnType<DatasetsApi["getDatasets"]> {
    return this.datasetsApi.getDatasets(...args);
  }

  getPreparations(...args: Parameters<DatasetsApi["getPreparations"]>): ReturnType<DatasetsApi["getPreparations"]> {
    return this.datasetsApi.getPreparations(...args);
  }

  createPreparation(...args: Parameters<DatasetsApi["createPreparation"]>): ReturnType<DatasetsApi["createPreparation"]> {
    return this.datasetsApi.createPreparation(...args);
  }

  configurePreparationMapping(...args: Parameters<DatasetsApi["configurePreparationMapping"]>): ReturnType<DatasetsApi["configurePreparationMapping"]> {
    return this.datasetsApi.configurePreparationMapping(...args);
  }

  confirmPreparation(...args: Parameters<DatasetsApi["confirmPreparation"]>): ReturnType<DatasetsApi["confirmPreparation"]> {
    return this.datasetsApi.confirmPreparation(...args);
  }

  publishPreparation(...args: Parameters<DatasetsApi["publishPreparation"]>): ReturnType<DatasetsApi["publishPreparation"]> {
    return this.datasetsApi.publishPreparation(...args);
  }

  sendPreparationToYield(...args: Parameters<DatasetsApi["sendPreparationToYield"]>): ReturnType<DatasetsApi["sendPreparationToYield"]> {
    return this.datasetsApi.sendPreparationToYield(...args);
  }

  getDatasetVersions(...args: Parameters<DatasetsApi["getDatasetVersions"]>): ReturnType<DatasetsApi["getDatasetVersions"]> {
    return this.datasetsApi.getDatasetVersions(...args);
  }

  createDataset(...args: Parameters<DatasetsApi["createDataset"]>): ReturnType<DatasetsApi["createDataset"]> {
    return this.datasetsApi.createDataset(...args);
  }

  getDatasetVersionPreview(...args: Parameters<DatasetsApi["getDatasetVersionPreview"]>): ReturnType<DatasetsApi["getDatasetVersionPreview"]> {
    return this.datasetsApi.getDatasetVersionPreview(...args);
  }

  getTrainingDrafts(...args: Parameters<TrainingApi["getTrainingDrafts"]>): ReturnType<TrainingApi["getTrainingDrafts"]> {
    return this.trainingApi.getTrainingDrafts(...args);
  }

  updateTrainingDraft(...args: Parameters<TrainingApi["updateTrainingDraft"]>): ReturnType<TrainingApi["updateTrainingDraft"]> {
    return this.trainingApi.updateTrainingDraft(...args);
  }

  startTrainingDraft(...args: Parameters<TrainingApi["startTrainingDraft"]>): ReturnType<TrainingApi["startTrainingDraft"]> {
    return this.trainingApi.startTrainingDraft(...args);
  }

  getTrainingRun(...args: Parameters<TrainingApi["getTrainingRun"]>): ReturnType<TrainingApi["getTrainingRun"]> {
    return this.trainingApi.getTrainingRun(...args);
  }

  getTrainingDraft(...args: Parameters<TrainingApi["getTrainingDraft"]>): ReturnType<TrainingApi["getTrainingDraft"]> {
    return this.trainingApi.getTrainingDraft(...args);
  }

  openTrainingRunEvents(...args: Parameters<TrainingApi["openTrainingRunEvents"]>): ReturnType<TrainingApi["openTrainingRunEvents"]> {
    return this.trainingApi.openTrainingRunEvents(...args);
  }

  resumeTrainingRun(...args: Parameters<TrainingApi["resumeTrainingRun"]>): ReturnType<TrainingApi["resumeTrainingRun"]> {
    return this.trainingApi.resumeTrainingRun(...args);
  }

  sendResultToReactor(...args: Parameters<TrainingApi["sendResultToReactor"]>): ReturnType<TrainingApi["sendResultToReactor"]> {
    return this.trainingApi.sendResultToReactor(...args);
  }

  getTrainingRunAttempts(...args: Parameters<TrainingApi["getTrainingRunAttempts"]>): ReturnType<TrainingApi["getTrainingRunAttempts"]> {
    return this.trainingApi.getTrainingRunAttempts(...args);
  }

  cancelTrainingRun(...args: Parameters<TrainingApi["cancelTrainingRun"]>): ReturnType<TrainingApi["cancelTrainingRun"]> {
    return this.trainingApi.cancelTrainingRun(...args);
  }

  getDeployments(...args: Parameters<DeploymentApi["getDeployments"]>): ReturnType<DeploymentApi["getDeployments"]> {
    return this.deploymentApi.getDeployments(...args);
  }

  stopDeployment(...args: Parameters<DeploymentApi["stopDeployment"]>): ReturnType<DeploymentApi["stopDeployment"]> {
    return this.deploymentApi.stopDeployment(...args);
  }

  getDeploymentEvents(...args: Parameters<DeploymentApi["getDeploymentEvents"]>): ReturnType<DeploymentApi["getDeploymentEvents"]> {
    return this.deploymentApi.getDeploymentEvents(...args);
  }

  getGatewayRoutes(...args: Parameters<ExchangeApi["getGatewayRoutes"]>): ReturnType<ExchangeApi["getGatewayRoutes"]> {
    return this.exchangeApi.getGatewayRoutes(...args);
  }

  getGatewayEndpoints(...args: Parameters<ExchangeApi["getGatewayEndpoints"]>): ReturnType<ExchangeApi["getGatewayEndpoints"]> {
    return this.exchangeApi.getGatewayEndpoints(...args);
  }

  confirmGatewayRoute(...args: Parameters<ExchangeApi["confirmGatewayRoute"]>): ReturnType<ExchangeApi["confirmGatewayRoute"]> {
    return this.exchangeApi.confirmGatewayRoute(...args);
  }

  listApiKeys(...args: Parameters<ExchangeApi["listApiKeys"]>): ReturnType<ExchangeApi["listApiKeys"]> {
    return this.exchangeApi.listApiKeys(...args);
  }

  createApiKey(...args: Parameters<ExchangeApi["createApiKey"]>): ReturnType<ExchangeApi["createApiKey"]> {
    return this.exchangeApi.createApiKey(...args);
  }

  revokeApiKey(...args: Parameters<ExchangeApi["revokeApiKey"]>): ReturnType<ExchangeApi["revokeApiKey"]> {
    return this.exchangeApi.revokeApiKey(...args);
  }

  getActiveRoute(...args: Parameters<ExchangeApi["getActiveRoute"]>): ReturnType<ExchangeApi["getActiveRoute"]> {
    return this.exchangeApi.getActiveRoute(...args);
  }

  setActiveRoute(...args: Parameters<ExchangeApi["setActiveRoute"]>): ReturnType<ExchangeApi["setActiveRoute"]> {
    return this.exchangeApi.setActiveRoute(...args);
  }

  getAssistantTasks(...args: Parameters<AssistantApi["getAssistantTasks"]>): ReturnType<AssistantApi["getAssistantTasks"]> {
    return this.assistantApi.getAssistantTasks(...args);
  }

  createAssistantTask(...args: Parameters<AssistantApi["createAssistantTask"]>): ReturnType<AssistantApi["createAssistantTask"]> {
    return this.assistantApi.createAssistantTask(...args);
  }

  getAssistantCapabilities(...args: Parameters<AssistantApi["getAssistantCapabilities"]>): ReturnType<AssistantApi["getAssistantCapabilities"]> {
    return this.assistantApi.getAssistantCapabilities(...args);
  }

  saveAssistantProvider(...args: Parameters<AssistantApi["saveAssistantProvider"]>): ReturnType<AssistantApi["saveAssistantProvider"]> {
    return this.assistantApi.saveAssistantProvider(...args);
  }

  deleteAssistantProvider(...args: Parameters<AssistantApi["deleteAssistantProvider"]>): ReturnType<AssistantApi["deleteAssistantProvider"]> {
    return this.assistantApi.deleteAssistantProvider(...args);
  }

  getAssistantTask(...args: Parameters<AssistantApi["getAssistantTask"]>): ReturnType<AssistantApi["getAssistantTask"]> {
    return this.assistantApi.getAssistantTask(...args);
  }

  cancelAssistantTask(...args: Parameters<AssistantApi["cancelAssistantTask"]>): ReturnType<AssistantApi["cancelAssistantTask"]> {
    return this.assistantApi.cancelAssistantTask(...args);
  }

  openAssistantTaskEvents(...args: Parameters<AssistantApi["openAssistantTaskEvents"]>): ReturnType<AssistantApi["openAssistantTaskEvents"]> {
    return this.assistantApi.openAssistantTaskEvents(...args);
  }

  getWorkApprovals(...args: Parameters<WorkApi["getWorkApprovals"]>): ReturnType<WorkApi["getWorkApprovals"]> {
    return this.workApi.getWorkApprovals(...args);
  }

  resolveWorkApproval(...args: Parameters<WorkApi["resolveWorkApproval"]>): ReturnType<WorkApi["resolveWorkApproval"]> {
    return this.workApi.resolveWorkApproval(...args);
  }

  getWorkInputs(...args: Parameters<WorkApi["getWorkInputs"]>): ReturnType<WorkApi["getWorkInputs"]> {
    return this.workApi.getWorkInputs(...args);
  }

  resolveWorkInput(...args: Parameters<WorkApi["resolveWorkInput"]>): ReturnType<WorkApi["resolveWorkInput"]> {
    return this.workApi.resolveWorkInput(...args);
  }

  getMemoryFacts(...args: Parameters<WorkApi["getMemoryFacts"]>): ReturnType<WorkApi["getMemoryFacts"]> {
    return this.workApi.getMemoryFacts(...args);
  }

  queryMemory(...args: Parameters<WorkApi["queryMemory"]>): ReturnType<WorkApi["queryMemory"]> {
    return this.workApi.queryMemory(...args);
  }

  saveMemoryFact(...args: Parameters<WorkApi["saveMemoryFact"]>): ReturnType<WorkApi["saveMemoryFact"]> {
    return this.workApi.saveMemoryFact(...args);
  }

  getWorkNotifications(...args: Parameters<WorkApi["getWorkNotifications"]>): ReturnType<WorkApi["getWorkNotifications"]> {
    return this.workApi.getWorkNotifications(...args);
  }

  uploadWorkAttachment(...args: Parameters<WorkApi["uploadWorkAttachment"]>): ReturnType<WorkApi["uploadWorkAttachment"]> {
    return this.workApi.uploadWorkAttachment(...args);
  }

  downloadWorkAttachment(...args: Parameters<WorkApi["downloadWorkAttachment"]>): ReturnType<WorkApi["downloadWorkAttachment"]> {
    return this.workApi.downloadWorkAttachment(...args);
  }

  getWorkConnectors(...args: Parameters<WorkApi["getWorkConnectors"]>): ReturnType<WorkApi["getWorkConnectors"]> {
    return this.workApi.getWorkConnectors(...args);
  }

  getQqHealth(...args: Parameters<WorkApi["getQqHealth"]>): ReturnType<WorkApi["getQqHealth"]> {
    return this.workApi.getQqHealth(...args);
  }

  startQqLogin(...args: Parameters<WorkApi["startQqLogin"]>): ReturnType<WorkApi["startQqLogin"]> {
    return this.workApi.startQqLogin(...args);
  }

  pollQqLogin(...args: Parameters<WorkApi["pollQqLogin"]>): ReturnType<WorkApi["pollQqLogin"]> {
    return this.workApi.pollQqLogin(...args);
  }
}
