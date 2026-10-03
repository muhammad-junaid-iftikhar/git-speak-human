import { config } from "./config";

export interface Flags {
  json: boolean;
  quiet: boolean;
  yes: boolean;
  dryRun: boolean;
  explain: boolean;
  noFun: boolean;
  noColor: boolean;
}

export const DEFAULT_FLAGS: Flags = {
  json: false,
  quiet: false,
  yes: false,
  dryRun: false,
  explain: false,
  noFun: false,
  noColor: false,
};

export const ctx = {
  flags: { ...DEFAULT_FLAGS } as Flags,
  agent: false,
  interactive: false,
  useColor: false,
  fun: false,
  command: "",
  data: {} as Record<string, unknown>,
  warnings: [] as string[],
  next: [] as string[],
  snapshotId: undefined as string | undefined,
};

export function initCtx(flags: Partial<Flags> = {}, opts: { forceAgent?: boolean } = {}): void {
  const env = process.env;
  const merged = { ...DEFAULT_FLAGS, ...flags };
  const tty = Boolean(process.stdout.isTTY);
  const stdinTty = Boolean(process.stdin.isTTY);
  ctx.flags = merged;
  ctx.agent = Boolean(opts.forceAgent || env.GITBUDDY_AGENT === "1" || env.CI || !tty);
  ctx.interactive = stdinTty && tty && !merged.json && !ctx.agent;
  ctx.useColor = tty && !merged.json && !merged.noColor && !env.NO_COLOR;
  ctx.fun = !merged.noFun && !ctx.agent && !merged.json && config().fun !== false;
  ctx.command = "";
  ctx.data = {};
  ctx.warnings = [];
  ctx.next = [];
  ctx.snapshotId = undefined;
}
