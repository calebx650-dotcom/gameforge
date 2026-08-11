export { scanProject, summarizeProjectContext } from "./scanner.js";
export type { ProjectContext, GitSummary, EngineKind } from "./scanner.js";
export { buildDependencyGraph, findDependencies, findDependents } from "./dependency-graph.js";
export type { DependencyGraph, DependencyGraphEntry } from "./dependency-graph.js";
