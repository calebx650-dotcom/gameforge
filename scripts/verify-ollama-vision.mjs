#!/usr/bin/env node
// Game Forge — Phase 1 real-world Ollama verification.
//
// This deliberately does NOT bypass Game Forge with a bare curl/API call.
// It imports the actual @gameforge/llm OllamaProvider (via createProvider,
// the same factory apps/server uses) and @gameforge/tools's real
// TOOL_DEFINITIONS, and drives them exactly the way the agent loop would:
// Game Forge -> OllamaProvider -> Ollama -> model -> response.
//
// Requires: `npm install && npm run build` already run in this repo (so
// packages/llm and packages/tools have built `dist/` output), and a real
// Ollama server reachable at --base-url.
//
// Usage:
//   node scripts/verify-ollama-vision.mjs --image ./photo.png [options]
//
// Options:
//   --model <id>       Ollama model to use (default: qwen2.5vl:7b)
//   --base-url <url>   Ollama base URL (default: http://127.0.0.1:11434)
//   --tools            Attach real Game Forge ToolDefinitions and nudge the
//                       model to call read_file, to test image + tool calling
//                       together (Step 4). Omit for a plain vision test (Step 3).
//   --stream           Use provider.stream() instead of provider.generate()
//                       (Step 5), with the same image content.

import { readFileSync } from "node:fs";
import { createProvider } from "@gameforge/llm";
import { TOOL_DEFINITIONS } from "@gameforge/tools";

function parseArgs(argv) {
  const args = { model: "qwen2.5vl:7b", baseUrl: "http://127.0.0.1:11434", tools: false, stream: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--image") args.image = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--tools") args.tools = true;
    else if (a === "--stream") args.stream = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.image) {
  console.error(
    "Usage: node scripts/verify-ollama-vision.mjs --image <path> [--model qwen2.5vl:7b] [--base-url http://127.0.0.1:11434] [--tools] [--stream]",
  );
  process.exit(1);
}

const imageBuffer = readFileSync(args.image);
const base64 = imageBuffer.toString("base64");
const mimeType = /\.(jpe?g)$/i.test(args.image) ? "image/jpeg" : "image/png";
// Deliberately wrapped as a data: URI so this run also exercises
// OllamaProvider's data:-prefix-stripping path, not just raw base64.
const dataUri = `data:${mimeType};base64,${base64}`;

const provider = createProvider({ provider: "ollama", model: args.model, baseUrl: args.baseUrl });

const promptText = args.tools
  ? "Look at this image and describe what you see. Then call the read_file tool to read a file at path 'notes.txt'."
  : "Describe exactly what you see in this image in one or two sentences.";

const messages = [
  {
    role: "user",
    content: [
      { type: "text", text: promptText },
      { type: "image", data: dataUri, mimeType },
    ],
  },
];

const generateOptions = {
  model: args.model,
  messages,
  tools: args.tools ? TOOL_DEFINITIONS.filter((t) => t.name === "read_file" || t.name === "list_directory") : undefined,
};

console.log("Game Forge OllamaProvider real verification");
console.log(`  model:    ${args.model}`);
console.log(`  baseUrl:  ${args.baseUrl}`);
console.log(`  image:    ${args.image} (${imageBuffer.length} bytes, ${mimeType})`);
console.log(`  tools:    ${args.tools ? `${generateOptions.tools.length} real ToolDefinition(s) attached` : "none (plain vision test)"}`);
console.log(`  mode:     ${args.stream ? "stream()" : "generate()"}`);
console.log("");

try {
  if (args.stream) {
    let text = "";
    let toolCalls;
    for await (const chunk of provider.stream(generateOptions)) {
      if (chunk.textDelta) {
        text += chunk.textDelta;
        process.stdout.write(chunk.textDelta);
      }
      if (chunk.toolCalls) toolCalls = chunk.toolCalls;
    }
    console.log("\n\n--- STREAM RESULT ---");
    console.log("Final text:", text || "(empty)");
    console.log("Tool calls:", toolCalls ? JSON.stringify(toolCalls, null, 2) : "(none)");
  } else {
    const result = await provider.generate(generateOptions);
    console.log("--- GENERATE RESULT ---");
    console.log(
      "Assistant text:",
      typeof result.message.content === "string" ? result.message.content : JSON.stringify(result.message.content),
    );
    console.log("Tool calls:", result.toolCalls?.length ? JSON.stringify(result.toolCalls, null, 2) : "(none)");
    console.log("Usage:", JSON.stringify(result.usage ?? {}, null, 2));
  }
  console.log("\nRESULT: Ollama server accepted the request and returned a response.");
} catch (err) {
  console.error("\nRESULT: FAILED —", err?.message ?? String(err));
  process.exit(1);
}
