import type { AgentMode, PermissionCategory } from "@gameforge/shared";

export type PermissionDecision = "allow" | "approve" | "deny";

export interface PermissionCheckInput {
  mode: AgentMode;
  category: PermissionCategory;
  /** Whether this specific tool call mutates project/engine state (default: true unless category is "read"). */
  mutating?: boolean;
  /** Set by execution tools when the command matches a known-dangerous pattern. Always forces "approve". */
  dangerous?: boolean;
}

/**
 * Central policy: given the current agent mode and what a tool call would
 * do, decide whether it proceeds silently, needs human approval, or is
 * refused outright. Tool implementations never make this call themselves.
 */
export function decidePermission(input: PermissionCheckInput): PermissionDecision {
  const mutating = input.mutating ?? input.category !== "read";

  if (input.category === "read" || !mutating) return "allow";
  if (input.dangerous) return "approve";

  switch (input.mode) {
    case "ask":
      return "deny";
    case "assist":
      return "approve";
    case "build":
    case "autonomous":
      return "allow";
    default:
      return "deny";
  }
}
