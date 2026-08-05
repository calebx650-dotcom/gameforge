/**
 * Heuristic detection of commands that should require explicit approval
 * regardless of agent mode. This is a safety net, not a sandbox — it
 * catches the obviously destructive/exfiltration-prone patterns, not
 * every possible way to cause harm. Combine with workspace restriction
 * and timeouts, never rely on this alone.
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f\b/i, // rm -rf variants
  /\brm\s+-[a-z]*f[a-z]*r\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{\s*:\|:&\s*\};/, // fork bomb
  />\s*\/dev\/sd/i,
  /\bsudo\b/i,
  /\bchmod\s+-R\s+777\b/i,
  /\bcurl\b.*\|\s*(sh|bash)\b/i,
  /\bwget\b.*\|\s*(sh|bash)\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\benv\b.*\b(AWS_|OPENAI_API_KEY|ANTHROPIC_API_KEY|SECRET|TOKEN)/i,
  /\bshutdown\b|\breboot\b/i,
  /\bkill\s+-9\s+1\b/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}
