#!/usr/bin/env node
// Game Forge — real-world verification: the Unity engine bridge against a
// genuinely running Unity Editor + CoplayDev/unity-mcp ("MCP for Unity")
// HTTP server.
//
// This drives real Game Forge code — not a bypass:
//   createEngineBridge({ engine: "unity", url }) -> UnityBridge -> McpHttpClient
//   -> real MCP "Streamable HTTP" handshake (initialize + Mcp-Session-Id session,
//      SSE-framed responses) -> real POST {url}/mcp -> real Unity Editor process
//
// The wire protocol here was reverse-engineered from a live server on
// 2026-08-09 (see UNITY_BRIDGE.md's "Real HTTP transport" section for how
// and why McpHttpClient looks the way it does) and is NOT the bare
// bespoke-JSON-over-HTTP shape an earlier version of this client assumed.
//
// Requires: `npm run build` already run (packages/engine-bridge needs a built
// dist/ output), and a real Unity Editor with the "MCP for Unity" package's
// local HTTP server actually running and reachable at --url (open the
// project, open Window > MCP for Unity, click "Start Server" if it isn't
// already running — or enable "Auto-Start on Editor Load" in Advanced
// Settings so it starts itself and connects its own Unity-side bridge
// session, which read_console below depends on).
//
// Usage:
//   node scripts/verify-unity-bridge.mjs [--url http://127.0.0.1:8080]

import { createEngineBridge } from "@gameforge/engine-bridge";

function parseArgs(argv) {
  const args = { url: "http://127.0.0.1:8080" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

console.log("Game Forge Unity bridge real verification");
console.log(`  url: ${args.url}`);
console.log("");

const bridge = createEngineBridge({ engine: "unity", url: args.url });

try {
  console.log("connect() — lists tools over a real MCP session (initialize handshake + tools/list)...");
  await bridge.connect();
  console.log(`  connected: ${bridge.isConnected()}`);
  console.log("");

  console.log("readConsole() — real, non-mutating tool call against the running Unity Editor...");
  const messages = await bridge.readConsole({ maxMessages: 5 });
  console.log(`  got ${messages.length} console message(s) back from the real Editor:`);
  for (const m of messages.slice(0, 5)) {
    console.log(`    [${m.level ?? "?"}] ${String(m.message ?? "").slice(0, 120)}`);
  }
  console.log("");

  console.log("RESULT: PASSED — real Unity Editor + MCP for Unity server responded to a real tool call over the real wire protocol.");
} catch (err) {
  console.error("\nRESULT: FAILED —", err?.message ?? String(err));
  console.error(
    "\nIf this is 'Unity session not available; please retry': the HTTP server is up but the\n" +
      "Unity-side bridge session hasn't connected yet. In the Unity Editor's MCP for Unity window,\n" +
      "make sure the session shows connected (or enable Advanced Settings > Auto-Start on Editor\n" +
      "Load, which starts the server AND connects the bridge session on its own).",
  );
  process.exit(1);
}
