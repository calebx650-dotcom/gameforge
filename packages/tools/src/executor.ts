import type { AgentMode, ToolCall, ToolResultMessage } from "@gameforge/shared";
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
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool } from "./git-tools.js";

export type ApprovalRequest = (call: ToolCall, reason: string) => Promise<boolean>;

/**
 * The single entry point tool calls flow through: resolves the tool
 * definition, applies the permission policy for the current agent mode,
 * requests human approval when required, then dispatches to the concrete
 * implementation. Nothing here bypasses WorkspaceGuard.
 */
export class ToolExecutor {
  constructor(
    private readonly guard: WorkspaceGuard,
    private readonly requestApproval: ApprovalRequest,
    private readonly generationProviders: GenerationProviders = {},
  ) {}

  async execute(call: ToolCall, mode: AgentMode): Promise<ToolResultMessage> {
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
      const content = await this.dispatch(call);
      return { role: "tool", toolCallId: call.id, name: call.name, content };
    } catch (err) {
      return this.errorResult(call, (err as Error).message);
    }
  }

  private async dispatch(call: ToolCall): Promise<string> {
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
        const result = await runCommandTool(this.guard, String(args.command), args.timeoutMs as number | undefined);
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
      default:
        if (isGenerationTool(call.name)) {
          return dispatchGenerationTool(call.name, args, this.generationProviders);
        }
        throw new Error(`No implementation registered for tool: ${call.name}`);
    }
  }

  private errorResult(call: ToolCall, message: string): ToolResultMessage {
    return { role: "tool", toolCallId: call.id, name: call.name, content: message, isError: true };
  }
}
