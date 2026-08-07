#!/usr/bin/env node
// Game Forge — Phase 3 real-world verification: the Kokoro local-first
// voice adapter against a real running Kokoro-FastAPI server.
//
// This drives the actual Game Forge code, not a bare curl/API experiment:
//   createVoiceProvider({ provider: "kokoro" })  (the real @gameforge/audio factory)
//   -> KokoroProvider.submitJob()                (the real adapter)
//   -> dispatchGenerationTool("generate_voice_line", ...)  (the real tool-dispatch path)
//
// Requires: `npm install && npm run build` already run, and a real
// Kokoro-FastAPI server reachable at --base-url (default
// http://127.0.0.1:8880 — Kokoro-FastAPI's documented default port).
//
// Usage:
//   node scripts/verify-kokoro-voice.mjs [--base-url http://127.0.0.1:8880]
//     [--voice af_heart] [--text "..."] [--out ./kokoro-test.mp3]

import { writeFileSync } from "node:fs";
import { createVoiceProvider } from "@gameforge/audio";
import { dispatchGenerationTool } from "@gameforge/tools";

function parseArgs(argv) {
  const args = {
    baseUrl: "http://127.0.0.1:8880",
    voice: "af_heart",
    text: "Game Forge is now speaking through a real local Kokoro server.",
    out: "./kokoro-verify-output.mp3",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--voice") args.voice = argv[++i];
    else if (a === "--text") args.text = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function decodeDataUri(dataUri) {
  const commaIndex = dataUri.indexOf(",");
  const base64 = dataUri.slice(commaIndex + 1);
  return Buffer.from(base64, "base64");
}

const args = parseArgs(process.argv.slice(2));

console.log("Game Forge Kokoro voice verification (Phase 3)");
console.log(`  baseUrl: ${args.baseUrl}`);
console.log(`  voice:   ${args.voice}`);
console.log(`  text:    "${args.text}"`);
console.log(`  out:     ${args.out}`);
console.log("");

// Step 1: the real VoiceProvider factory + real KokoroProvider adapter.
const provider = createVoiceProvider({ provider: "kokoro", baseUrl: args.baseUrl });

console.log("--- Direct VoiceProvider test (createVoiceProvider -> KokoroProvider.submitJob) ---");
const directJob = await provider.submitJob({ text: args.text, voiceId: args.voice });

if (directJob.status !== "succeeded") {
  console.error(`RESULT: FAILED — job did not succeed: ${directJob.error ?? "(no error message)"}`);
  process.exit(1);
}

const audioBytes = decodeDataUri(directJob.result.audioUrl);
if (audioBytes.length === 0) {
  console.error("RESULT: FAILED — server returned success but zero audio bytes.");
  process.exit(1);
}
writeFileSync(args.out, audioBytes);
console.log(`Received ${audioBytes.length} bytes of real audio, saved to ${args.out}`);
console.log("Play that file — if it's your requested text spoken aloud, the adapter is genuinely working.");
console.log("");

// Step 2: the same request through the real generate_voice_line tool-dispatch
// path (packages/tools/src/generation-tools.ts), the way the agent would call it.
console.log("--- Tool-dispatch test (dispatchGenerationTool(\"generate_voice_line\", ...)) ---");
const toolResultJson = await dispatchGenerationTool(
  "generate_voice_line",
  { text: args.text, voiceId: args.voice },
  { voice: provider },
);
const toolResult = JSON.parse(toolResultJson);
console.log("Tool dispatch status:", toolResult.status);
console.log("Tool dispatch returned audio:", Boolean(toolResult.result?.audioUrl));

if (toolResult.status === "succeeded" && toolResult.result?.audioUrl) {
  console.log("\nRESULT: PASSED — both the direct provider path and the real tool-dispatch path produced real audio from a real Kokoro server.");
} else {
  console.log("\nRESULT: DID NOT FULLY SUCCEED — see tool dispatch output above.");
  process.exit(1);
}
