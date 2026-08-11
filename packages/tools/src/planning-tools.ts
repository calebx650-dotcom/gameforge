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
 * Per-run bookkeeping for the P2 "does the agent know if it did the right
 * thing" gap: a plain in-memory record of the agent's stated plan and the
 * discrete, checkable requirements it derived from the user's request,
 * updated as the agent verifies each one. This is deliberately *not*
 * enforced — nothing blocks a run that skips planning/tracking, the same
 * way nothing forces a human developer to write a checklist before coding.
 * The value is in giving the model (and the end-of-run report) a structured
 * place to put "here's what I think I need to do" and "here's what I
 * actually confirmed," instead of that living only informally in prose.
 * One instance lives for the lifetime of a single `ToolExecutor` (i.e. one
 * chat request / one `Agent.run()`), never persisted or shared across runs.
 */
export class TaskPlanTracker {
  private plan: string[] = [];
  private requirements: Requirement[] = [];
  private nextId = 1;

  setPlan(steps: string[]): void {
    this.plan = steps;
  }

  /** Replaces the requirement list, assigning each a fresh id in order — calling this again resets tracking, it doesn't append. */
  setRequirements(descriptions: string[]): Requirement[] {
    this.requirements = descriptions.map((description) => ({ id: this.nextId++, description, status: "pending" as const }));
    return this.requirements;
  }

  updateRequirementStatus(id: number, status: RequirementStatus, note?: string): Requirement {
    const requirement = this.requirements.find((r) => r.id === id);
    if (!requirement) {
      throw new Error(`No requirement with id ${id}. Call set_requirements first, then use the id it returns.`);
    }
    requirement.status = status;
    if (note !== undefined) requirement.note = note;
    return requirement;
  }

  snapshot(): TaskPlanSnapshot {
    return { plan: this.plan, requirements: this.requirements };
  }
}
