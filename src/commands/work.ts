import { ctx } from "../context";
import { EXIT, fail } from "../errors";
import { git, out } from "../git";
import { define } from "../registry";
import { isDirty, operation, status } from "../repo";
import { changedFiles, cleanTree, parts, record } from "../snapshot";
import { readState, readWorkspaces, writeWorkspaces } from "../state";
import { ago, c, plural, stamp, ui } from "../ui";
import {
  TRASH_REF,
  WORK_REF,
  activeWorkspace,
  enterWorkspace,
  findWorkspace,
  listWorkspaces,
  moveWorkspaceRef,
  requireWorkspace,
  saveWorkspace,
  setActive,
  uniqueSlug,
  type Workspace,
} from "../workspaces";

function blockIfBusy(): void {
  if (operation()) fail("Finish sorting out the current clash first.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See: gitbuddy conflicts" });
  if (readState().away) fail("You're looking at the past right now.", { hint: "Go back first: gitbuddy back" });
  if (status().conflicted.length) fail("Some files still have clashes to sort out.", { exit: EXIT.CONFLICT, code: "conflict", hint: "See: gitbuddy conflicts" });
}

function parkCurrent(): string | null {
  const active = activeWorkspace();
  if (active) {
    saveWorkspace(active.slug);
    return active.name;
  }
  if (isDirty()) {
    const name = `unsaved work ${stamp(Date.now())}`;
    saveWorkspace(uniqueSlug(name), name);
    return name;
  }
  return null;
}

function switchTo(target: Workspace): void {
  record("switch", `before switching to "${target.name}"`);
  const parked = parkCurrent();
  if (parked) ui.say("save", `Saved ${c.accent(parked)} so you can come back to it.`);
  const { conflicts } = enterWorkspace(target);
  ui.say("switch", c.ok(`You're now working on ${c.bold(target.name)}`) + c.dim(` · last touched ${ago(target.updated)}`));
  ctx.data = { workspace: target.name, slug: target.slug, parked, conflicts };
  if (conflicts) {
    ui.warn("Your team changed some of the same lines since you last worked on this. Nothing is lost.");
    ui.next("gitbuddy conflicts", "sort out the clashes");
  }
}

define({
  name: "work",
  aliases: ["start", "new-work", "task"],
  group: "work",
  summary: "Start working on something new (your current work is kept safe)",
  args: [{ name: "name", description: "A name for what you're working on", required: true, variadic: true }],
  mutates: true,
  undoable: true,
  examples: ['gitbuddy work "dark mode"', 'gitbuddy work "fix login bug"'],
  run({ args }) {
    blockIfBusy();
    const name = args.join(" ").trim();
    const existing = findWorkspace(name);
    if (existing) {
      if (existing.active) {
        ui.say("work", `You're already working on ${c.bold(existing.name)}.`);
        ctx.data = { workspace: existing.name, slug: existing.slug, created: false };
        return;
      }
      ui.info(`You already have ${c.accent(existing.name)}, so switching to it.`);
      switchTo(existing);
      return;
    }
    record("work", `before starting "${name}"`);
    const active = activeWorkspace();
    const carried = !active && isDirty();
    if (active) {
      saveWorkspace(active.slug);
      cleanTree();
      ui.say("save", `Saved ${c.accent(active.name)} so you can come back to it.`);
    }
    const slug = uniqueSlug(name);
    saveWorkspace(slug, name);
    setActive(slug);
    ui.say("work", c.ok(`Started ${c.bold(name)}`));
    if (carried) ui.hint("The changes you already had are now part of it.");
    else ui.hint("Fresh start from your latest saved work.");
    ctx.data = { workspace: name, slug, created: true, parked: active?.name ?? null, carriedChanges: carried };
    ui.next("gitbuddy list", "see everything you're working on");
  },
});

define({
  name: "switch",
  aliases: ["go", "switch-to", "resume"],
  group: "work",
  summary: "Jump to another thing you're working on",
  args: [{ name: "name", description: "Which workspace to switch to", variadic: true }],
  mutates: true,
  undoable: true,
  examples: ['gitbuddy switch "dark mode"', "gitbuddy switch"],
  run({ args }) {
    blockIfBusy();
    const all = listWorkspaces();
    let target: Workspace;
    if (!args.length) {
      const others = all.filter((w) => !w.active);
      if (!others.length) fail("You have no other workspaces yet.", { hint: 'Start one: gitbuddy work "name"' });
      target = ui.pick(
        "Where to?",
        others.map((w) => ({ label: `${w.name} ${c.dim(`· ${ago(w.updated)}`)}`, value: w })),
      );
    } else target = requireWorkspace(args.join(" "));
    if (target.active) {
      ui.say("work", `You're already on ${c.bold(target.name)}.`);
      ctx.data = { workspace: target.name, slug: target.slug };
      return;
    }
    switchTo(target);
  },
});

define({
  name: "list",
  aliases: ["my-work", "workspaces", "ls"],
  group: "work",
  summary: "See everything you're working on, with dates",
  examples: ["gitbuddy list"],
  run() {
    const all = listWorkspaces();
    const active = readState().active;
    const live = isDirty();
    ctx.data = {
      active: active ?? null,
      workspaces: all.map((w) => ({
        name: w.name,
        slug: w.slug,
        active: w.active,
        created: w.created,
        updated: w.updated,
        changedFiles: changedFiles(w.commit),
      })),
    };
    if (!all.length) {
      ui.say("list", "No workspaces yet.");
      ui.next('gitbuddy work "what you\'re doing"', "start one");
      return;
    }
    ui.say("list", c.bold("Your work"));
    ui.blank();
    ui.table(
      all.map((w) => {
        const files = w.active && live ? status().files.length : changedFiles(w.commit);
        return [
          w.active ? c.accent("▶") : " ",
          w.active ? c.bold(w.name) : w.name,
          c.dim(`${ago(w.updated)} (${stamp(w.updated)})`),
          files ? plural(files, "changed file") : c.dim("no changes"),
        ];
      }),
    );
    ui.blank();
    ui.next('gitbuddy switch "name"', "jump to one");
  },
});

define({
  name: "save",
  aliases: ["checkpoint", "keep"],
  group: "work",
  summary: "Save your progress without making it permanent (files stay as they are)",
  mutates: true,
  undoable: true,
  examples: ["gitbuddy save"],
  run() {
    const active = activeWorkspace();
    const id = record("save", "checkpoint");
    const files = status().files.length;
    if (active) {
      saveWorkspace(active.slug);
      ui.say("save", c.ok(`Progress saved in ${c.bold(active.name)}`) + c.dim(` · ${plural(files, "changed file")} · ${stamp(Date.now())}`));
    } else {
      ui.say("save", c.ok("Checkpoint saved") + c.dim(` · ${plural(files, "changed file")} · ${stamp(Date.now())}`));
      ui.hint('Tip: give your work a name with gitbuddy work "name" to juggle several things.');
    }
    ui.hint("Your files are untouched. If anything goes wrong: gitbuddy undo");
    ctx.data = { workspace: active?.name ?? null, snapshot: id, changedFiles: files };
  },
});

define({
  name: "peek",
  group: "work",
  summary: "Look at a workspace's changes without switching to it",
  args: [{ name: "name", description: "Which workspace", required: true, variadic: true }],
  options: { full: { type: "boolean", description: "Show every changed line" } },
  examples: ['gitbuddy peek "dark mode"'],
  run({ args, opts }) {
    const w = requireWorkspace(args.join(" "));
    const p = parts(w.commit);
    const from = p.base ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const color = ctx.useColor ? "--color=always" : "--no-color";
    const text = out(["diff", color, opts.full ? "--patch" : "--stat", from, p.workTree]);
    ctx.data = { workspace: w.name, files: out(["diff", "--name-only", from, p.workTree]).split("\n").filter(Boolean) };
    ui.say("search", `${c.bold(w.name)} ${c.dim(`· ${ago(w.updated)}`)}`);
    ui.line(text || c.dim("   no changes"));
  },
});

define({
  name: "rename",
  group: "work",
  summary: "Rename a workspace",
  args: [
    { name: "old", description: "The current name", required: true },
    { name: "new", description: "The new name", required: true, variadic: true },
  ],
  mutates: true,
  examples: ['gitbuddy rename "dark mode" "night theme"'],
  run({ args }) {
    const w = requireWorkspace(args[0]);
    const name = args.slice(1).join(" ").trim();
    if (findWorkspace(name)) fail(`You already have a workspace called "${name}".`);
    const slug = uniqueSlug(name);
    git(["update-ref", "--create-reflog", `${WORK_REF}${slug}`, w.commit], { mutates: true });
    git(["update-ref", "-d", `${WORK_REF}${w.slug}`], { mutates: true });
    if (!ctx.flags.dryRun) {
      const meta = readWorkspaces();
      meta[slug] = { ...(meta[w.slug] ?? { created: w.created, updated: w.updated }), name } as never;
      delete meta[w.slug];
      writeWorkspaces(meta);
      if (w.active) setActive(slug);
    }
    ui.ok(`Renamed ${w.name} → ${name}`);
    ctx.data = { from: w.name, to: name, slug };
  },
});

define({
  name: "drop",
  aliases: ["delete-work"],
  group: "work",
  summary: "Throw away a workspace (it goes to the trash for 30 days)",
  args: [{ name: "name", description: "Which workspace", required: true, variadic: true }],
  mutates: true,
  destructive: true,
  examples: ['gitbuddy drop "old idea"'],
  run({ args }) {
    const w = requireWorkspace(args.join(" "));
    if (!ui.confirm(`Throw away "${w.name}"? (you can get it back with gitbuddy restore)`, { default: true })) return;
    if (w.active) saveWorkspace(w.slug);
    const fresh = listWorkspaces().find((x) => x.slug === w.slug) ?? w;
    const ref = moveWorkspaceRef(fresh.slug, TRASH_REF);
    ui.say("trash", `Moved ${c.bold(w.name)} to the trash.`);
    if (w.active) ui.hint("Your files are untouched; they're just not tied to a workspace any more.");
    ctx.data = { dropped: w.name, trashRef: ref };
    ui.next("gitbuddy trash", "see what's in the trash");
  },
});
