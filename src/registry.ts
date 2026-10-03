import { fail } from "./errors";

export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface OptSpec {
  type: "boolean" | "string" | "list";
  description: string;
  short?: string;
}

export type Opts = Record<string, string | boolean | string[] | undefined>;

export interface Input {
  args: string[];
  opts: Opts;
  raw: string[];
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  group: string;
  summary: string;
  gitEquivalent?: string;
  examples?: string[];
  args?: ArgSpec[];
  options?: Record<string, OptSpec>;
  needsRepo?: boolean;
  mutates?: boolean;
  destructive?: boolean;
  undoable?: boolean;
  network?: boolean;
  interactiveOnly?: boolean;
  hidden?: boolean;
  rawArgs?: boolean;
  run(input: Input): void | Promise<void>;
}

export const GROUPS: Record<string, string> = {
  start: "Getting started",
  everyday: "Everyday",
  work: "Workspaces (many tasks at once)",
  safety: "Safety net",
  history: "History & finding things",
  fix: "Fixing mistakes",
  team: "Teamwork",
  release: "Releases & housekeeping",
  you: "You & gitbuddy",
  agent: "For scripts & AI agents",
};

const commands: CommandDef[] = [];

export function define(def: CommandDef): CommandDef {
  commands.push(def);
  return def;
}

export const allCommands = () => commands;

export function findCommand(name: string): CommandDef | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}

export function validateRegistry(): void {
  const seen = new Map<string, string>();
  for (const c of commands) {
    for (const n of [c.name, ...(c.aliases ?? [])]) {
      const prev = seen.get(n);
      if (prev) throw new Error(`gitbuddy bug: "${n}" is used by both "${prev}" and "${c.name}"`);
      seen.set(n, c.name);
    }
  }
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function suggestCommand(name: string): string[] {
  const names = commands.filter((c) => !c.hidden).flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  return names
    .map((n) => ({ n, d: distance(name, n) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(name.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.n);
}

export function parseInput(def: CommandDef, argv: string[]): Input {
  const opts: Opts = {};
  const args: string[] = [];
  const specs = def.options ?? {};
  const byShort = new Map(Object.entries(specs).filter(([, s]) => s.short).map(([k, s]) => [s.short!, k]));
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest || !a.startsWith("-") || a === "-") {
      args.push(a);
      continue;
    }
    if (a === "--") {
      rest = true;
      continue;
    }
    let key: string;
    let inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq > 0 ? a.slice(eq + 1) : undefined;
    } else {
      key = byShort.get(a.slice(1)) ?? a.slice(1);
    }
    const spec = specs[key];
    if (!spec) {
      if (/^-\d+$/.test(a)) {
        args.push(a);
        continue;
      }
      fail(`I don't know the option "${a}" for "${def.name}".`, { code: "bad_option", hint: `See: gitbuddy help ${def.name}` });
    }
    if (spec.type === "boolean") {
      opts[key] = inline === undefined ? true : !/^(false|0|no)$/i.test(inline);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) fail(`"--${key}" needs a value.`, { code: "bad_option" });
    if (spec.type === "list") opts[key] = [...((opts[key] as string[]) ?? []), value];
    else opts[key] = value;
  }
  const required = (def.args ?? []).filter((x) => x.required);
  if (args.length < required.length) {
    const missing = required[args.length];
    fail(`"${def.name}" needs ${missing.description.toLowerCase()}.`, {
      code: "missing_arg",
      hint: def.examples?.[0] ? `Example: ${def.examples[0]}` : `See: gitbuddy help ${def.name}`,
    });
  }
  return { args, opts, raw: argv };
}
