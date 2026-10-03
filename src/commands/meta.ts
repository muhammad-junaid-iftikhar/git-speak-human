import { ctx } from "../context";
import { fail } from "../errors";
import { GROUPS, allCommands, define, findCommand, suggestCommand, type CommandDef } from "../registry";
import { theme } from "../theme";
import { c, ui } from "../ui";
import { VERSION } from "../version";

export function describe(def: CommandDef) {
  return {
    name: def.name,
    aliases: def.aliases ?? [],
    group: def.group,
    summary: def.summary,
    git: def.gitEquivalent ?? null,
    args: def.args ?? [],
    options: def.options ?? {},
    examples: def.examples ?? [],
    mutates: Boolean(def.mutates),
    destructive: Boolean(def.destructive),
    undoable: Boolean(def.undoable),
    network: Boolean(def.network),
    interactiveOnly: Boolean(def.interactiveOnly),
  };
}

function usage(def: CommandDef): string {
  const args = (def.args ?? []).map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`) + (a.variadic ? "…" : ""));
  return ["gitbuddy", def.name, ...args, def.options ? "[options]" : ""].filter(Boolean).join(" ");
}

function commandHelp(def: CommandDef): void {
  ctx.data = describe(def);
  ui.line(`${c.bold(def.name)} ${c.dim("—")} ${def.summary}`);
  ui.blank();
  ui.line(`   ${c.accent(usage(def))}`);
  if (def.aliases?.length) ui.line(c.dim(`   also: ${def.aliases.join(", ")}`));
  if (def.gitEquivalent) ui.line(c.dim(`   in git: ${def.gitEquivalent}`));
  if (def.args?.length) {
    ui.blank();
    ui.table(def.args.map((a) => [c.accent(a.name), a.description]));
  }
  if (def.options) {
    ui.blank();
    ui.table(Object.entries(def.options).map(([k, o]) => [c.accent(`--${k}${o.short ? `, -${o.short}` : ""}`), o.description]));
  }
  if (def.examples?.length) {
    ui.blank();
    ui.line(c.dim("   examples"));
    for (const e of def.examples) ui.line(`   ${e}`);
  }
  if (def.destructive) ui.line(c.warn("\n   Careful: this throws something away (gitbuddy will ask first)."));
  else if (def.undoable) ui.line(c.dim("\n   Changed your mind afterwards? gitbuddy undo"));
}

export function overview(): void {
  const t = theme();
  ui.line(`${t.mascot}  ${c.bold("gitbuddy")} ${c.dim(`v${VERSION}`)} ${c.dim("· git, but human")}`);
  ui.blank();
  ui.line(`   ${c.dim("usage:")} gitbuddy ${c.accent("<command>")} ${c.dim("[stuff]")}     ${c.dim("type")} gitbuddy ${c.dim("alone for the friendly menu")}`);
  const visible = allCommands().filter((d) => !d.hidden);
  for (const [key, title] of Object.entries(GROUPS)) {
    const cmds = visible.filter((d) => d.group === key);
    if (!cmds.length) continue;
    ui.blank();
    ui.line(c.bold(title));
    ui.table(cmds.map((d) => [c.accent(d.name), d.summary]));
  }
  ui.blank();
  ui.line(c.dim("   Every command: --explain (show the real git), --dry-run, --json, --yes, --quiet, --no-fun"));
  ui.line(c.dim("   More about one command: gitbuddy help <command>"));
  ctx.data = { version: VERSION, commands: visible.map(describe) };
}

define({
  name: "help",
  aliases: ["h", "?"],
  group: "you",
  summary: "Show all commands, or explain one",
  args: [{ name: "command", description: "A command to explain" }],
  needsRepo: false,
  examples: ["gitbuddy help", "gitbuddy help work"],
  run({ args }) {
    if (!args.length) return overview();
    const def = findCommand(args[0]);
    if (!def) {
      const close = suggestCommand(args[0]);
      fail(`There's no command called "${args[0]}".`, { hint: close.length ? `Did you mean: ${close.join(", ")}?` : "See all: gitbuddy help" });
    }
    commandHelp(def!);
  },
});

define({
  name: "version",
  aliases: ["v"],
  group: "you",
  summary: "Show which gitbuddy you have",
  needsRepo: false,
  run() {
    ctx.data = { version: VERSION };
    ui.line(`gitbuddy ${VERSION}`);
  },
});
