import type { RouteId } from "../../services/navigator/src/router";
export const productPages: { id: RouteId; zh: string; en: string }[] = [
  { id: "models", zh: "模型管理", en: "Models" }, { id: "datasets", zh: "数据集管理", en: "Datasets" },
  { id: "training", zh: "训练管理", en: "Training" }, { id: "runs", zh: "Product 运行", en: "Product runs" },
  { id: "deployments", zh: "部署管理", en: "Deployments" }, { id: "gateway", zh: "网关管理", en: "Gateway" },
  { id: "chat", zh: "模型对话", en: "Model chat" }, { id: "overview", zh: "服务状态", en: "Service status" }, { id: "settings", zh: "连接与凭据", en: "Connections & credentials" },
  { id: "assistant", zh: "工作助手", en: "Work assistant" },
];
