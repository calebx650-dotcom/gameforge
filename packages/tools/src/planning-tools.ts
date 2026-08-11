export type RequirementStatus = "pending" | "met" | "unmet";

export interface Requirement {
  id: number;
  description: string;
  status: RequirementStatus;
  note?: string;
}

export interface TaskPlanSnapshot {
  plan: string[];
  requirements: Requirement[];
}

/**
 * Tool calls that plausibly *check* something, as opposed to changing
 * something or doing pure bookkeeping — the set `updateRequirementStatus`
 * requires at least one of, since a requirement's creation, before it will
 * accept a `"met"` verdict. Deliberately broad (any read/build/test/console/
 * play-mode call counts, not just ones that obviously relate to the
 * specific requirement) — this is a structural guard against "declared met
 * with literally zero checking," not a semantic check that the *right*
 * verification happened. See `TaskPlanTracker`'s class doc comment.
 */
const VERIFICATION_TOOL_NAMES = new Set([
  "read_file",
  "search_project",
  "list_directory",
  "inspect_dependencies",
  "git_status",
  "git_diff",
  "git_log",
  "inspect_scene",
  "inspect_object",
  "read_console",
  "capture_screenshot",
  "build_project",
  "run_tests",
  "enter_play_mode",
  "exit_play_mode",
  "run_command",
]);

/**
 * Per-run bookkeeping for the P2 "does the agent know if it did the right
 * thing" gap: a plain in-memory record of the agent's stated plan and the
 * discrete, checkable requirements it derived from the user's request,
 * updated as the agent verifies each one. Planning itself is deliberately
 * *not* enforced — nothing blocks a run that skips `set_plan`/
 * `set_requirements` entirely, the same way nothing forces a human
 * developer to write a checklist before coding. The value is in giving the
 * model (and the end-of-run report) a structured place to put "here's what
 * I think I need to do" and "here's what I actually confirmed," instead of
 * that living only informally in prose.
 *
 * One thing *is* enforced: `updateRequirementStatus` refuses to mark a
 * requirement `"met"` unless at least one verification-shaped tool call
 * (see `VERIFICATION_TOOL_NAMES`) has happened since that requirement was
 * created via `setRequirements`. This is a structural guard, not a
 * semantic one — it can't confirm the model checked the *right* thing, only
 * that it checked *something* rather than declaring victory with zero
 * verification, a real and common failure mode this catches for free.
 * `"unmet"`/`"pending"` are never gated, since claiming a problem or
 * leaving something unverified are never the risky direction.
 *
 * One instance lives for the lifetime of a single `ToolExecutor` (i.e. one
 * chat request / one `Agent.run()`), never persisted or shared across runs.
 */
export class TaskPlanTracker {
  private plan: string[] = [];
  private requirements: Requirement[] = [];
  private nextId = 1;
  private verificationCallCount = 0;
  private requirementCreatedAt = new Map<number, number>();

  setPlan(steps: string[]): void {
    this.plan = steps;
  }

  /** Replaces the requirement list, assigning each a fresh id in order — calling this again resets tracking, it doesn't append. */
  setRequirements(descriptions: string[]): Requirement[] {
    const createdAtCallCount = this.verificationCallCount;
    this.requirementCreatedAt = new Map();
    this.requirements = descriptions.map((description) => {
      const id = this.nextId++;
      this.requirementCreatedAt.set(id, createdAtCallCount);
      return { id, description, status: "pending" as const };
    });
    return this.requirements;
  }

  /** Called by `ToolExecutor` after every successful tool dispatch — counts toward the `"met"` verification guard when the tool is verification-shaped. */
  recordToolCall(name: string): void {
    if (VERIFICATION_TOOL_NAMES.has(name)) this.verificationCallCount++;
  }

  updateRequirementStatus(id: number, status: RequirementStatus, note?: string): Requirement {
    const requirement = this.requirements.find((r) => r.id === id);
    if (!requirement) {
      throw new Error(`No requirement with id ${id}. Call set_requirements first, then use the id it returns.`);
    }
    if (status === "met") {
      const createdAt = this.requirementCreatedAt.get(id) ?? 0;
      if (this.verificationCallCount <= createdAt) {
        throw new Error(
          `Cannot mark requirement ${id} ("${requirement.description}") as "met" without checking it first — ` +
            `no read/build/test/console/play-mode tool call has happened since this requirement was created. ` +
            `Actually verify it (read the file, run the tests, check the console, enter play mode, etc.) before marking it met.`,
        );
      }
    }
    requirement.status = status;
    if (note !== undefined) requirement.note = note;
    return requirement;
  }

  snapshot(): TaskPlanSnapshot {
    return { plan: this.plan, requirements: this.requirements };
  }
}
