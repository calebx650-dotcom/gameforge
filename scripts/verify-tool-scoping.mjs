#!/usr/bin/env node
// Game Forge — Phase 2 real-world verification: tool-calling reliability
// on a real local Ollama model, using the *scoped* tool set instead of
// the full static 42-tool list.
//
// This drives the actual Game Forge Agent orchestration — not a bare
// OllamaProvider.generate() call, and not a curl/API bypass:
//   Agent.run() -> ToolExecutor.getAvailableTools() -> provider.generate()
//   -> real tool call -> ToolExecutor.execute() -> real file read
//
// Requires: `npm install && npm run build` already run (packages/agent,
// packages/tools, packages/llm need built dist/ output), and a real Ollama
// server reachable at --base-url with a tool-calling-capable model pulled.
//
// Usage:
//   node scripts/verify-tool-scoping.mjs [--model llama3.2:latest] [--base-url http://127.0.0.1:11434]

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider } from "@gameforge/llm";
import { ToolExecutor, WorkspaceGuard, TOOL_DEFINITIONS } from "@gameforge/tools";
import { Agent } from "@gameforge/agent";

function parseArgs(argv) {
  const args = { model: "llama3.2:latest", baseUrl: "http://127.0.0.1:11434" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") args.model = argv[++i];
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// Real temp project on disk — the same WorkspaceGuard/read_file path a real
// Game Forge session would use, not a mocked filesystem.
const projectRoot = mkdtempSync(join(tmpdir(), "gameforge-phase2-verify-"));
const secretValue = `phase-two-verification-token-${Date.now()}`;
writeFileSync(join(projectRoot, "notes.txt"), `The secret value is: ${secretValue}\n`);

const guard = new WorkspaceGuard(projectRoot);
// No engine bridge, no generation providers configured for this session —
// this is exactly the configuration that should exclude all 12 engine
// tools and all 6 vendor-backed generation tools from what's advertised.
const executor = new ToolExecutor(guard, async () => true);
const provider = createProvider({ provider: "ollama", model: args.model, baseUrl: args.baseUrl });

const scopedTools = executor.getAvailableTools();

console.log("Game Forge tool-scoping real verification (Phase 2)");
console.log(`  model:           ${args.model}`);
console.log(`  baseUrl:         ${args.baseUrl}`);
console.log(`  project root:    ${projectRoot} (temp, real files on disk)`);
console.log(`  full tool count: ${TOOL_DEFINITIONS.length}`);
console.log(`  scoped tool count sent to the model: ${scopedTools.length}`);
console.log(`  engine tools included:     ${scopedTools.some((t) => t.name === "inspect_scene")} (expected false, no bridge configured)`);
console.log(`  generate_3d_model included: ${scopedTools.some((t) => t.name === "generate_3d_model")} (expected false, no vendor configured)`);
console.log("");

const agent = new Agent({
  provider,
  model: args.model,
  systemPrompt:
    "You are Game Forge, an AI pair-programmer. You have file tools for the current project. " +
    "Use them when asked to look at project files.",
  executor,
  mode: "build",
  maxIterations: 5,
});

try {
  const result = await agent.run([
    { role: "user", content: "Read notes.txt in this project and tell me exactly what secret value it contains." },
  ]);

  console.log("--- AGENT RUN RESULT ---");
  console.log("Stopped reason:", result.stoppedReason);
  console.log("Iterations:", result.iterations);
  console.log("");
  console.log("Tool call log:");
  for (const entry of result.log) {
    console.log(`  [${entry.kind}] ${entry.summary}`);
  }
  console.log("");

  const finalMessage = result.messages[result.messages.length - 1];
  const finalText = typeof finalMessage?.content === "string" ? finalMessage.content : JSON.stringify(finalMessage?.content);
  console.log("Final assistant message:", finalText);
  console.log("");

  const calledReadFile = result.log.some((e) => e.kind === "tool_call" && e.summary.includes("read_file"));
  const gotSecretBack = finalText?.includes(secretValue);

  console.log(`RESULT: read_file was called: ${calledReadFile}`);
  console.log(`RESULT: correct secret value appeared in the final answer: ${Boolean(gotSecretBack)}`);
  if (calledReadFile && gotSecretBack) {
    console.log("\nRESULT: PASSED — real tool call, with the scoped tool set, produced the correct answer.");
  } else {
    console.log("\nRESULT: DID NOT FULLY SUCCEED — see the log and final message above for what actually happened.");
  }
} catch (err) {
  console.error("\nRESULT: FAILED —", err?.message ?? String(err));
  process.exit(1);
}
