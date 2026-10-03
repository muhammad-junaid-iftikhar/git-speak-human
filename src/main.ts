import { ctx, initCtx, type Flags } from "./context";
import { BuddyError, EXIT, fail } from "./errors";
import { findCommand, parseInput, suggestCommand, validateRegistry, type CommandDef } from "./registry";
import { ensureGit, ensureRepo } from "./repo";
import { stripAnsi, ui } from "./ui";
import { maybeAutosave } from "./workspaces";

const GLOBAL: Record<string, keyof Flags> = {
  "--json": "json",
  "--quiet": "quiet",
  "-q": "quiet",
  "--yes": "yes",
  "-y": "yes",
  "--dry-run": "dryRun",
  "--explain": "explain",
  "--no-fun": "noFun",
  "--no-color": "noColor",
};

export interface RunResult {
  schema: 1;
  ok: boolean;
  command: string;
  exit_code: number;
  data: Record<string, unknown>;
  warnings: string[];
  next_steps: string[];
  snapshot_id: string | null;
  error?: { code: string; message: string; hint: string | null };
}

export const hooks = {
  before: [] as ((def: CommandDef) => void)[],
  after: [] as ((def: CommandDef, result: RunResult) => void)[],
  noCommand: null as null | (() => Promise<void>),
};

export function splitGlobals(argv: string[]): { flags: Partial<Flags>; rest: string[]; help: boolean } {
  const flags: Partial<Flags> = {};
  const rest: string[] = [];
  let help = false;
  let passthrough = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (passthrough) {
      rest.push(a);
      continue;
    }
    if (a === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (GLOBAL[a]) {
      flags[GLOBAL[a]] = true;
      continue;
    }
    if ((a === "--version" || a === "-v" || a === "-V") && !rest.length) {
      rest.push("version");
      continue;
    }
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    rest.push(a);
    if (rest.length === 1 && findCommand(a)?.rawArgs) passthrough = true;
  }
  return { flags, rest, help };
}

export async function execute(argv: string[], opts: { forceAgent?: boolean } = {}): Promise<RunResult> {
  const { flags, rest, help } = splitGlobals(argv);
  initCtx(flags, opts);
  validateRegistry();
  let def: CommandDef | undefined;
  try {
    if (!rest.length) {
      if (!help && ctx.interactive && hooks.noCommand) await hooks.noCommand();
      else await findCommand("help")!.run({ args: [], opts: {}, raw: [] });
      ctx.command = "help";
    } else {
      const [name, ...cmdArgs] = rest;
      def = findCommand(name);
      if (!def) {
        const close = suggestCommand(name.toLowerCase());
        fail(`I don't know "${name}" yet.`, {
          code: "unknown_command",
          hint: close.length ? `Did you mean: ${close.map((x) => `gitbuddy ${x}`).join(", ")}?` : "See everything I can do: gitbuddy help",
        });
      }
      ctx.command = def!.name;
      if (help) {
        await findCommand("help")!.run({ args: [def!.name], opts: {}, raw: [] });
      } else {
        if (def!.interactiveOnly && !ctx.interactive) {
          fail(`"${def!.name}" needs a person at the keyboard.`, { code: "interactive_only", hint: `See: gitbuddy help ${def!.name}` });
        }
        if (def!.needsRepo !== false) {
          ensureGit();
          ensureRepo();
          maybeAutosave();
        }
        for (const h of hooks.before) h(def!);
        const input = def!.rawArgs ? { args: cmdArgs, opts: {}, raw: cmdArgs } : parseInput(def!, cmdArgs);
        await def!.run(input);
      }
    }
    const result = buildResult(true, EXIT.OK);
    if (def) for (const h of hooks.after) safely(() => h(def!, result));
    return result;
  } catch (e) {
    const err =
      e instanceof BuddyError
        ? e
        : new BuddyError(`Something unexpected went wrong: ${(e as Error)?.message ?? e}`, {
            code: "internal",
            details: (e as Error)?.stack,
            hint: "Please report it at https://github.com/muhammad-junaid-iftikhar/git-speak-human/issues",
          });
    if (!ctx.flags.json) ui.error(err);
    const result = buildResult(false, err.exit);
    result.error = { code: err.code, message: stripAnsi(err.message), hint: err.hint ?? null };
    if (err.details && process.env.GITBUDDY_DEBUG) result.data.details = err.details;
    return result;
  }
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* fun extras must never break a command */
  }
}

function buildResult(ok: boolean, exit: number): RunResult {
  return {
    schema: 1,
    ok,
    command: ctx.command,
    exit_code: exit,
    data: ctx.data,
    warnings: ctx.warnings,
    next_steps: ctx.next,
    snapshot_id: ctx.snapshotId ?? null,
  };
}
