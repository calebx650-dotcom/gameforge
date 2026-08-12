// Run via a genuinely separate `node` process (see plugin-loader.test.ts's
// runLoadPluginsInRealProcess) — not imported by any test file directly. Loads plugins from
// the directory given as argv[2], optionally dispatches the calls given as JSON in argv[3],
// and prints a JSON-serializable result to stdout for the spawning test to parse.
import { loadPlugins } from "./plugin-loader.js";

interface DispatchCall {
  name: string;
  args: Record<string, unknown>;
}

const [pluginsDir, dispatchCallsJson] = process.argv.slice(2);
const dispatchCalls: DispatchCall[] = dispatchCallsJson ? JSON.parse(dispatchCallsJson) : [];

const { plugins, errors } = await loadPlugins(pluginsDir);

const dispatchResults: Array<{ name: string; result: string }> = [];
for (const call of dispatchCalls) {
  const plugin = plugins.find((p) => p.definition.name === call.name);
  if (!plugin) continue;
  dispatchResults.push({ name: call.name, result: await plugin.dispatch(call.args) });
}

process.stdout.write(
  JSON.stringify({
    plugins: plugins.map((p) => ({ definition: p.definition, filePath: p.filePath })),
    errors,
    dispatchResults,
  }),
);
