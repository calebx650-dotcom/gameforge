import type { ToolDefinition } from "@gameforge/shared";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a text file within the project workspace.",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and subdirectories at a given path within the project workspace.",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project root, default '.'" } },
    },
  },
  {
    name: "search_project",
    description: "Search project files for a text or regex pattern.",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        globPattern: { type: "string", description: "Optional glob to restrict file types, e.g. '**/*.ts'" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given content. Fails if the file already exists.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string match in an existing file with new content.",
    category: "write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file within the project workspace.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "create_directory",
    description: "Create a directory (and parents) within the project workspace.",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command inside the project workspace with a timeout.",
    category: "execution",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number", description: "Defaults to 30000, capped at 120000" },
      },
      required: ["command"],
    },
  },
];

export function findToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
