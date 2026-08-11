import type { AgentMode, ToolCall, ToolDefinition, ToolResultMessage } from "@gameforge/shared";
import type { EngineBridge } from "@gameforge/engine-bridge";
import { findToolDefinition } from "./definitions.js";
import { isDangerousCommand } from "./dangerous-commands.js";
import {
  createDirectoryTool,
  createFileTool,
  deleteFileTool,
  editFileTool,
  listDirectoryTool,
  readFileTool,
  searchProjectTool,
} from "./fs-tools.js";
import { runCommandTool } from "./exec-tool.js";
import { decidePermission } from "./permissions.js";
import type { WorkspaceGuard } from "./workspace.js";
import { dispatchGenerationTool, isGenerationTool, type GenerationProviders } from "./generation-tools.js";
import { dispatchEngineTool, isEngineTool } from "./engine-tools.js";
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool } from "./git-tools.js";
import { getAvailableTools } from "./tool-scope.js";
import { TaskPlanTracker } from "./planning-tools.js";
import { buildDependencyGraph, findDependencies, findDependents } from "@gameforge/project";

export type ApprovalRequest = (call: ToolCall, reason: string) => Promise<boolean>;

/**
 * The single entry point tool calls flow through: resolves the tool
 * definition, applies the permission policy for the current agent mode,
 * requests human approval when required, then dispatches to the concrete
 * implementation. Nothing here bypasses WorkspaceGuard.
 */
export class ToolExecutor {
  private readonly taskPlanTracker = new TaskPlanTracker();

  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly requestApproval: ApprovalRequest,
    private readonly generationProviders: GenerationProviders = {},
    private readonly engineBridge?: EngineBridge,
  ) {}

  /** The plan/requirements state `set_plan`/`set_requirements`/`update_requirement_status` calls have accumulated so far in this executor's lifetime (one per chat request). */
  getTaskPlanTracker(): TaskPlanTracker {
    return this.taskPlanTracker;
  }

  /**
   * The tools this session can actually use, given whichever generation
   * vendors and engine bridge were configured — see tool-scope.ts. This is
   * what should be sent to the model on every turn instead of the full,
   * static `TOOL_DEFINITIONS` list.
   */
  getAvailableTools(): ToolDefinition[] {
    return getAvailableTools(this.generationProviders, this.engineBridge);
  }

  async execute(call: ToolCall, mode: AgentMode, signal?: AbortSignal): Promise<ToolResultMessage> {
    const definition = findToolDefinition(call.name);
    if (!definition) {
      return this.errorResult(call, `Unknown tool: ${call.name}`);
    }

    const dangerous = call.name === "run_command" && isDangerousCommand(String(call.arguments.command ?? ""));
    const decision = decidePermission({
      mode,
      category: definition.category,
      mutating: definition.mutating,
      dangerous,
      costsMoney: definition.costsMoney,
    });

    if (decision === "deny") {
      return this.errorResult(call, `Tool "${call.name}" is not permitted in "${mode}" mode.`);
    }
    if (decision === "approve") {
      const reason = definition.costsMoney
        ? `"${call.name}" calls a metered external service and may cost money.`
        : dangerous
          ? `Command matches a dangerous pattern: ${call.arguments.command}`
          : `"${call.name}" modifies the project (mode: ${mode}).`;
      const approved = await this.requestApproval(call, reason);
      if (!approved) {
        return this.errorResult(call, `User declined to approve "${call.name}".`);
      }
    }

    try {
      const content = await this.dispatch(call, signal);
      this.taskPlanTracker.recordToolCall(call.name);
      return { role: "tool", toolCallId: call.id, name: call.name, content };
    } catch (err) {
      return this.errorResult(call, (err as Error).message);
    }
  }

  private async dispatch(call: ToolCall, signal?: AbortSignal): Promise<string> {
    const args = call.arguments;
    switch (call.name) {
      case "read_file":
        return readFileTool(this.guard, String(args.path));
      case "list_directory": {
        const entries = await listDirectoryTool(this.guard, args.path ? String(args.path) : ".");
        return JSON.stringify(entries);
      }
      case "search_project": {
        const matches = await searchProjectTool(this.guard, String(args.query), args.maxResults as number | undefined);
        return JSON.stringify(matches);
      }
      case "inspect_dependencies": {
        const path = normalizeGraphPath(String(args.path));
        const graph = await buildDependencyGraph(this.guard.root);
        return JSON.stringify({ dependsOn: findDependencies(graph, path), dependedOnBy: findDependents(graph, path) });
      }
      case "create_file":
        await createFileTool(this.guard, String(args.path), String(args.content ?? ""));
        return `Created ${args.path}`;
      case "edit_file":
        await editFileTool(this.guard, String(args.path), String(args.oldText), String(args.newText));
        return `Edited ${args.path}`;
      case "delete_file":
        await deleteFileTool(this.guard, String(args.path));
        return `Deleted ${args.path}`;
      case "create_directory":
        await createDirectoryTool(this.guard, String(args.path));
        return `Created directory ${args.path}`;
      case "run_command": {
        const result = await runCommandTool(this.guard, String(args.command), args.timeoutMs as number | undefined, signal);
        return JSON.stringify(result);
      }
      case "git_status":
        return JSON.stringify(await gitStatusTool(this.guard));
      case "git_diff":
        return gitDiffTool(this.guard, args.path as string | undefined);
      case "git_log":
        return JSON.stringify(await gitLogTool(this.guard, args.limit as number | undefined));
      case "git_branch":
        return JSON.stringify(await gitBranchTool(this.guard));
      case "git_commit":
        return JSON.stringify(await gitCommitTool(this.guard, String(args.message), args.paths as string[] | undefined));
      case "set_plan": {
        this.taskPlanTracker.setPlan((args.steps as string[]) ?? []);
        return `Plan recorded (${(args.steps as string[])?.length ?? 0} step(s)).`;
      }
      case "set_requirements": {
        const requirements = this.taskPlanTracker.setRequirements((args.requirements as string[]) ?? []);
        return JSON.stringify(requirements);
      }
      case "update_requirement_status": {
        const requirement = this.taskPlanTracker.updateRequirementStatus(
          Number(args.id),
          args.status as "pending" | "met" | "unmet",
          args.note as string | undefined,
        );
        return JSON.stringify(requirement);
      }
      default:
        if (isGenerationTool(call.name)) {
          return dispatchGenerationTool(call.name, args, this.generationProviders);
        }
        if (isEngineTool(call.name)) {
          return dispatchEngineTool(call.name, args, this.engineBridge);
        }
        throw new Error(`No implementation registered for tool: ${call.name}`);
    }
  }

  private errorResult(call: ToolCall, message: string): ToolResultMessage {
    return { role: "tool", toolCallId: call.id, name: call.name, content: message, isError: true };
  }
}

/** `buildDependencyGraph`'s entries are forward-slash, no-leading-"./" relative paths — normalize whatever form the model passed so a lookup isn't a silent miss just because of a leading "./" or backslashes. */
function normalizeGraphPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
