// ┌─────────────────────────────────────────────────────────────────────┐
// │ Module: Assistant child environment declarations                   │
// │ Role: Type the launcher environment split for TypeScript tests.     │
// │ 中文：模块职责：为 TypeScript 测试描述启动器环境分流接口。          │
// └─────────────────────────────────────────────────────────────────────┘

export type AssistantEnvironment = Record<string, string | undefined>;

export const ISOLATED_ENVIRONMENT_ALLOWLIST: readonly string[];
export const NAVIGATOR_FACTORY_ENVIRONMENT_NAMES: readonly string[];
export function createNavigatorChildEnvironment(
  sharedEnvironment: AssistantEnvironment,
  inheritedEnvironment: AssistantEnvironment,
  navigatorFactoryEnvironment: AssistantEnvironment,
): AssistantEnvironment;
export function prepareAssistantEnvironment(
  source: AssistantEnvironment,
  isolated: boolean,
): {
  inheritedEnvironment: AssistantEnvironment;
  sharedEnvironment: AssistantEnvironment;
  navigatorFactoryEnvironment: AssistantEnvironment;
};
