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
import { ConversationMemoryApi } from "./api/conversation-memory";
import { ConversationDomainsApi } from "./api/conversation-domains";
import { ConversationOperationsApi } from "./api/conversation-operations";
import { ConversationPeripheralApi } from "./api/conversation-peripheral";
import { ConversationTurnsApi } from "./api/conversation-turns";

export * from "./api/types";
export * from "./api/errors";
export * from "./api/conversation-memory";
export * from "./api/conversation-domains";
export * from "./api/conversation-operations";
export * from "./api/conversation-peripheral";
export * from "./api/conversation-turns";
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
  private readonly conversationMemoryApi = new ConversationMemoryApi(this);
  private readonly conversationDomainsApi = new ConversationDomainsApi(this);
  private readonly conversationOperationsApi = new ConversationOperationsApi(this);
  private readonly conversationPeripheralApi = new ConversationPeripheralApi(this);
  private readonly conversationTurnsApi = new ConversationTurnsApi(this);

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

  getConversationMemoryOverview(...args: Parameters<ConversationMemoryApi["getOverview"]>): ReturnType<ConversationMemoryApi["getOverview"]> {
    return this.conversationMemoryApi.getOverview(...args);
  }

  getConversationMessages(...args: Parameters<ConversationMemoryApi["getMessages"]>): ReturnType<ConversationMemoryApi["getMessages"]> {
    return this.conversationMemoryApi.getMessages(...args);
  }

  listConversationMemories(...args: Parameters<ConversationMemoryApi["listMemories"]>): ReturnType<ConversationMemoryApi["listMemories"]> {
    return this.conversationMemoryApi.listMemories(...args);
  }

  queryConversationMemories(...args: Parameters<ConversationMemoryApi["queryMemories"]>): ReturnType<ConversationMemoryApi["queryMemories"]> {
    return this.conversationMemoryApi.queryMemories(...args);
  }

  createConversationMemory(...args: Parameters<ConversationMemoryApi["createMemory"]>): ReturnType<ConversationMemoryApi["createMemory"]> {
    return this.conversationMemoryApi.createMemory(...args);
  }

  updateConversationMemory(...args: Parameters<ConversationMemoryApi["updateMemory"]>): ReturnType<ConversationMemoryApi["updateMemory"]> {
    return this.conversationMemoryApi.updateMemory(...args);
  }

  deleteConversationMemory(...args: Parameters<ConversationMemoryApi["deleteMemory"]>): ReturnType<ConversationMemoryApi["deleteMemory"]> {
    return this.conversationMemoryApi.deleteMemory(...args);
  }

  listConversationMemorySources(...args: Parameters<ConversationMemoryApi["listSources"]>): ReturnType<ConversationMemoryApi["listSources"]> {
    return this.conversationMemoryApi.listSources(...args);
  }

  revokeConversationMemorySource(...args: Parameters<ConversationMemoryApi["revokeSource"]>): ReturnType<ConversationMemoryApi["revokeSource"]> {
    return this.conversationMemoryApi.revokeSource(...args);
  }

  createConversationMemorySourceGrant(...args: Parameters<ConversationMemoryApi["createSourceGrant"]>): ReturnType<ConversationMemoryApi["createSourceGrant"]> {
    return this.conversationMemoryApi.createSourceGrant(...args);
  }

  revokeConversationMemorySourceGrant(...args: Parameters<ConversationMemoryApi["revokeSourceGrant"]>): ReturnType<ConversationMemoryApi["revokeSourceGrant"]> {
    return this.conversationMemoryApi.revokeSourceGrant(...args);
  }

  getConversationPersonas(...args: Parameters<ConversationDomainsApi["getPersonas"]>): ReturnType<ConversationDomainsApi["getPersonas"]> {
    return this.conversationDomainsApi.getPersonas(...args);
  }

  getConversationPersonaBinding(...args: Parameters<ConversationDomainsApi["getPersonaBinding"]>): ReturnType<ConversationDomainsApi["getPersonaBinding"]> {
    return this.conversationDomainsApi.getPersonaBinding(...args);
  }

  putConversationPersonaBinding(...args: Parameters<ConversationDomainsApi["putPersonaBinding"]>): ReturnType<ConversationDomainsApi["putPersonaBinding"]> {
    return this.conversationDomainsApi.putPersonaBinding(...args);
  }

  putConversationPersona(...args: Parameters<ConversationDomainsApi["putPersona"]>): ReturnType<ConversationDomainsApi["putPersona"]> {
    return this.conversationDomainsApi.putPersona(...args);
  }

  createProfileCandidate(...args: Parameters<ConversationDomainsApi["createProfileCandidate"]>): ReturnType<ConversationDomainsApi["createProfileCandidate"]> {
    return this.conversationDomainsApi.createProfileCandidate(...args);
  }

  listProfileCandidates(...args: Parameters<ConversationDomainsApi["listProfileCandidates"]>): ReturnType<ConversationDomainsApi["listProfileCandidates"]> {
    return this.conversationDomainsApi.listProfileCandidates(...args);
  }

  listConversationProfiles(...args: Parameters<ConversationDomainsApi["listConversationProfiles"]>): ReturnType<ConversationDomainsApi["listConversationProfiles"]> {
    return this.conversationDomainsApi.listConversationProfiles(...args);
  }

  activateProfileCandidate(...args: Parameters<ConversationDomainsApi["activateProfileCandidate"]>): ReturnType<ConversationDomainsApi["activateProfileCandidate"]> {
    return this.conversationDomainsApi.activateProfileCandidate(...args);
  }

  rollbackConversationProfile(...args: Parameters<ConversationDomainsApi["rollbackProfile"]>): ReturnType<ConversationDomainsApi["rollbackProfile"]> {
    return this.conversationDomainsApi.rollbackProfile(...args);
  }

  createGraphProposal(...args: Parameters<ConversationDomainsApi["createGraphProposal"]>): ReturnType<ConversationDomainsApi["createGraphProposal"]> {
    return this.conversationDomainsApi.createGraphProposal(...args);
  }

  listGraphChangesets(...args: Parameters<ConversationDomainsApi["listGraphChangesets"]>): ReturnType<ConversationDomainsApi["listGraphChangesets"]> {
    return this.conversationDomainsApi.listGraphChangesets(...args);
  }

  applyGraphChangeset(...args: Parameters<ConversationDomainsApi["applyGraphChangeset"]>): ReturnType<ConversationDomainsApi["applyGraphChangeset"]> {
    return this.conversationDomainsApi.applyGraphChangeset(...args);
  }

  queryConversationGraph(...args: Parameters<ConversationDomainsApi["queryGraph"]>): ReturnType<ConversationDomainsApi["queryGraph"]> {
    return this.conversationDomainsApi.queryGraph(...args);
  }

  createMaintenanceJob(...args: Parameters<ConversationOperationsApi["createMaintenanceJob"]>): ReturnType<ConversationOperationsApi["createMaintenanceJob"]> {
    return this.conversationOperationsApi.createMaintenanceJob(...args);
  }

  listMaintenanceJobs(...args: Parameters<ConversationOperationsApi["listMaintenanceJobs"]>): ReturnType<ConversationOperationsApi["listMaintenanceJobs"]> {
    return this.conversationOperationsApi.listMaintenanceJobs(...args);
  }

  getMaintenanceJob(...args: Parameters<ConversationOperationsApi["getMaintenanceJob"]>): ReturnType<ConversationOperationsApi["getMaintenanceJob"]> {
    return this.conversationOperationsApi.getMaintenanceJob(...args);
  }

  checkpointMaintenanceJob(...args: Parameters<ConversationOperationsApi["checkpointMaintenanceJob"]>): ReturnType<ConversationOperationsApi["checkpointMaintenanceJob"]> {
    return this.conversationOperationsApi.checkpointMaintenanceJob(...args);
  }

  cancelMaintenanceJob(...args: Parameters<ConversationOperationsApi["cancelMaintenanceJob"]>): ReturnType<ConversationOperationsApi["cancelMaintenanceJob"]> {
    return this.conversationOperationsApi.cancelMaintenanceJob(...args);
  }

  createResearchNote(...args: Parameters<ConversationOperationsApi["createResearchNote"]>): ReturnType<ConversationOperationsApi["createResearchNote"]> {
    return this.conversationOperationsApi.createResearchNote(...args);
  }

  listResearchNotes(...args: Parameters<ConversationOperationsApi["listResearchNotes"]>): ReturnType<ConversationOperationsApi["listResearchNotes"]> {
    return this.conversationOperationsApi.listResearchNotes(...args);
  }

  listVerifiedConversationSkills(...args: Parameters<ConversationOperationsApi["listVerifiedSkills"]>): ReturnType<ConversationOperationsApi["listVerifiedSkills"]> {
    return this.conversationOperationsApi.listVerifiedSkills(...args);
  }

  createConversationWatch(...args: Parameters<ConversationOperationsApi["createWatch"]>): ReturnType<ConversationOperationsApi["createWatch"]> {
    return this.conversationOperationsApi.createWatch(...args);
  }

  listConversationWatches(...args: Parameters<ConversationOperationsApi["listWatches"]>): ReturnType<ConversationOperationsApi["listWatches"]> {
    return this.conversationOperationsApi.listWatches(...args);
  }

  cancelConversationWatch(...args: Parameters<ConversationOperationsApi["cancelWatch"]>): ReturnType<ConversationOperationsApi["cancelWatch"]> {
    return this.conversationOperationsApi.cancelWatch(...args);
  }

  createConversationFocusItem(...args: Parameters<ConversationOperationsApi["createFocusItem"]>): ReturnType<ConversationOperationsApi["createFocusItem"]> {
    return this.conversationOperationsApi.createFocusItem(...args);
  }

  listConversationFocusItems(...args: Parameters<ConversationOperationsApi["listFocusItems"]>): ReturnType<ConversationOperationsApi["listFocusItems"]> {
    return this.conversationOperationsApi.listFocusItems(...args);
  }

  transitionConversationFocusItem(...args: Parameters<ConversationOperationsApi["transitionFocusItem"]>): ReturnType<ConversationOperationsApi["transitionFocusItem"]> {
    return this.conversationOperationsApi.transitionFocusItem(...args);
  }

  createConversationHandoff(...args: Parameters<ConversationOperationsApi["createHandoff"]>): ReturnType<ConversationOperationsApi["createHandoff"]> {
    return this.conversationOperationsApi.createHandoff(...args);
  }

  getConversationHandoff(...args: Parameters<ConversationOperationsApi["getHandoff"]>): ReturnType<ConversationOperationsApi["getHandoff"]> {
    return this.conversationOperationsApi.getHandoff(...args);
  }

  getActiveBehaviorPolicy(...args: Parameters<ConversationOperationsApi["getActiveBehaviorPolicy"]>): ReturnType<ConversationOperationsApi["getActiveBehaviorPolicy"]> {
    return this.conversationOperationsApi.getActiveBehaviorPolicy(...args);
  }

  putActiveBehaviorPolicy(...args: Parameters<ConversationOperationsApi["putActiveBehaviorPolicy"]>): ReturnType<ConversationOperationsApi["putActiveBehaviorPolicy"]> {
    return this.conversationOperationsApi.putActiveBehaviorPolicy(...args);
  }

  createConversationReviewEvent(...args: Parameters<ConversationOperationsApi["createReviewEvent"]>): ReturnType<ConversationOperationsApi["createReviewEvent"]> {
    return this.conversationOperationsApi.createReviewEvent(...args);
  }

  listConversationReviewEvents(...args: Parameters<ConversationOperationsApi["listReviewEvents"]>): ReturnType<ConversationOperationsApi["listReviewEvents"]> {
    return this.conversationOperationsApi.listReviewEvents(...args);
  }

  previewConversationImport(...args: Parameters<ConversationOperationsApi["previewConversationImport"]>): ReturnType<ConversationOperationsApi["previewConversationImport"]> {
    return this.conversationOperationsApi.previewConversationImport(...args);
  }

  applyConversationImport(...args: Parameters<ConversationOperationsApi["applyConversationImport"]>): ReturnType<ConversationOperationsApi["applyConversationImport"]> {
    return this.conversationOperationsApi.applyConversationImport(...args);
  }

  rollbackConversationImport(...args: Parameters<ConversationOperationsApi["rollbackConversationImport"]>): ReturnType<ConversationOperationsApi["rollbackConversationImport"]> {
    return this.conversationOperationsApi.rollbackConversationImport(...args);
  }

  searchConversationMediaAssets(...args: Parameters<ConversationPeripheralApi["searchMediaAssets"]>): ReturnType<ConversationPeripheralApi["searchMediaAssets"]> {
    return this.conversationPeripheralApi.searchMediaAssets(...args);
  }

  getConversationMediaAsset(...args: Parameters<ConversationPeripheralApi["getMediaAsset"]>): ReturnType<ConversationPeripheralApi["getMediaAsset"]> {
    return this.conversationPeripheralApi.getMediaAsset(...args);
  }

  importConversationMediaAsset(...args: Parameters<ConversationPeripheralApi["importMediaAsset"]>): ReturnType<ConversationPeripheralApi["importMediaAsset"]> {
    return this.conversationPeripheralApi.importMediaAsset(...args);
  }

  deleteConversationMediaAsset(...args: Parameters<ConversationPeripheralApi["deleteMediaAsset"]>): ReturnType<ConversationPeripheralApi["deleteMediaAsset"]> {
    return this.conversationPeripheralApi.deleteMediaAsset(...args);
  }

  restoreConversationMediaAsset(...args: Parameters<ConversationPeripheralApi["restoreMediaAsset"]>): ReturnType<ConversationPeripheralApi["restoreMediaAsset"]> {
    return this.conversationPeripheralApi.restoreMediaAsset(...args);
  }

  renderConversationMediaCard(...args: Parameters<ConversationPeripheralApi["renderMediaCard"]>): ReturnType<ConversationPeripheralApi["renderMediaCard"]> {
    return this.conversationPeripheralApi.renderMediaCard(...args);
  }

  downloadConversationMediaAsset(...args: Parameters<ConversationPeripheralApi["downloadMediaAsset"]>): ReturnType<ConversationPeripheralApi["downloadMediaAsset"]> {
    return this.conversationPeripheralApi.downloadMediaAsset(...args);
  }

  getSpeechConfig(...args: Parameters<ConversationPeripheralApi["getSpeechConfig"]>): ReturnType<ConversationPeripheralApi["getSpeechConfig"]> {
    return this.conversationPeripheralApi.getSpeechConfig(...args);
  }

  putSpeechConfig(...args: Parameters<ConversationPeripheralApi["putSpeechConfig"]>): ReturnType<ConversationPeripheralApi["putSpeechConfig"]> {
    return this.conversationPeripheralApi.putSpeechConfig(...args);
  }

  getSpeechStatus(...args: Parameters<ConversationPeripheralApi["getSpeechStatus"]>): ReturnType<ConversationPeripheralApi["getSpeechStatus"]> {
    return this.conversationPeripheralApi.getSpeechStatus(...args);
  }

  transcribeWorkAttachment(...args: Parameters<ConversationPeripheralApi["transcribeAttachment"]>): ReturnType<ConversationPeripheralApi["transcribeAttachment"]> {
    return this.conversationPeripheralApi.transcribeAttachment(...args);
  }

  getBilibiliAccounts(...args: Parameters<ConversationPeripheralApi["getBilibiliAccounts"]>): ReturnType<ConversationPeripheralApi["getBilibiliAccounts"]> {
    return this.conversationPeripheralApi.getBilibiliAccounts(...args);
  }

  getBilibiliConnections(...args: Parameters<ConversationPeripheralApi["getBilibiliConnections"]>): ReturnType<ConversationPeripheralApi["getBilibiliConnections"]> {
    return this.conversationPeripheralApi.getBilibiliConnections(...args);
  }

  beginBilibiliLink(...args: Parameters<ConversationPeripheralApi["beginBilibiliLink"]>): ReturnType<ConversationPeripheralApi["beginBilibiliLink"]> {
    return this.conversationPeripheralApi.beginBilibiliLink(...args);
  }

  getBilibiliLinkStatus(...args: Parameters<ConversationPeripheralApi["getBilibiliLinkStatus"]>): ReturnType<ConversationPeripheralApi["getBilibiliLinkStatus"]> {
    return this.conversationPeripheralApi.getBilibiliLinkStatus(...args);
  }

  listBilibiliReadOperations(...args: Parameters<ConversationPeripheralApi["listBilibiliReadOperations"]>): ReturnType<ConversationPeripheralApi["listBilibiliReadOperations"]> {
    return this.conversationPeripheralApi.listBilibiliReadOperations(...args);
  }

  runBilibiliRead(...args: Parameters<ConversationPeripheralApi["runBilibiliRead"]>): ReturnType<ConversationPeripheralApi["runBilibiliRead"]> {
    return this.conversationPeripheralApi.runBilibiliRead(...args);
  }

  runBilibiliWrite(...args: Parameters<ConversationPeripheralApi["runBilibiliWrite"]>): ReturnType<ConversationPeripheralApi["runBilibiliWrite"]> {
    return this.conversationPeripheralApi.runBilibiliWrite(...args);
  }

  getBilibiliOperationByIdempotencyKey(...args: Parameters<ConversationPeripheralApi["getBilibiliOperationByIdempotencyKey"]>): ReturnType<ConversationPeripheralApi["getBilibiliOperationByIdempotencyKey"]> {
    return this.conversationPeripheralApi.getBilibiliOperationByIdempotencyKey(...args);
  }

  getWorkOperationReceipt(...args: Parameters<ConversationPeripheralApi["getWorkOperation"]>): ReturnType<ConversationPeripheralApi["getWorkOperation"]> {
    return this.conversationPeripheralApi.getWorkOperation(...args);
  }

  submitConversationTurn(...args: Parameters<ConversationTurnsApi["submitTurn"]>): ReturnType<ConversationTurnsApi["submitTurn"]> {
    return this.conversationTurnsApi.submitTurn(...args);
  }

  getConversationTurnTask(...args: Parameters<ConversationTurnsApi["getTask"]>): ReturnType<ConversationTurnsApi["getTask"]> {
    return this.conversationTurnsApi.getTask(...args);
  }

  openConversationTurnTaskEvents(...args: Parameters<ConversationTurnsApi["openTaskEvents"]>): ReturnType<ConversationTurnsApi["openTaskEvents"]> {
    return this.conversationTurnsApi.openTaskEvents(...args);
  }

  createConversationBackup(...args: Parameters<ConversationPeripheralApi["createActorBackup"]>): ReturnType<ConversationPeripheralApi["createActorBackup"]> {
    return this.conversationPeripheralApi.createActorBackup(...args);
  }

  downloadConversationBackup(...args: Parameters<ConversationPeripheralApi["downloadActorBackup"]>): ReturnType<ConversationPeripheralApi["downloadActorBackup"]> {
    return this.conversationPeripheralApi.downloadActorBackup(...args);
  }
}
