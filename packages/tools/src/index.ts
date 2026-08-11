export { WorkspaceGuard, WorkspaceViolationError } from "./workspace.js";
export { TOOL_DEFINITIONS, findToolDefinition } from "./definitions.js";
export { decidePermission } from "./permissions.js";
export type { PermissionDecision } from "./permissions.js";
export { isDangerousCommand } from "./dangerous-commands.js";
export { ToolExecutor } from "./executor.js";
export type { ApprovalRequest } from "./executor.js";
export * from "./fs-tools.js";
export * from "./exec-tool.js";
export { dispatchGenerationTool, isGenerationTool, GENERATION_TOOL_NAMES } from "./generation-tools.js";
export type { GenerationProviders } from "./generation-tools.js";
export {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBranchTool,
  gitCommitTool,
  maybeCreateCheckpoint,
  restoreCheckpoint,
  InvalidCommitReferenceError,
} from "./git-tools.js";
export type { GitStatusResult, GitLogEntry, GitBranchResult, GitCommitResult, CheckpointResult } from "./git-tools.js";
export { dispatchEngineTool, isEngineTool, ENGINE_TOOL_NAMES } from "./engine-tools.js";
export { getAvailableTools } from "./tool-scope.js";
export { TaskPlanTracker } from "./planning-tools.js";
export type { Requirement, RequirementStatus, TaskPlanSnapshot } from "./planning-tools.js";
export { loadPlugins } from "./plugin-loader.js";
export type { PluginModule, LoadedPlugin, PluginLoadError, PluginLoadResult } from "./plugin-loader.js";
export { GENERATION_TOOL_PROVIDER_KEY } from "./generation-tools.js";
