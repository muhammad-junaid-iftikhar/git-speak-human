import { ctx } from "../context";
import { tryOut } from "../git";
import { execute, type RunResult } from "../main";
import { allCommands, define, findCommand, type CommandDef } from "../registry";
import { currentBranch, defaultBranch, head, mainRemote, operation, remoteUrl, repoRoot, status } from "../repo";
import { readJournal } from "../snapshot";
import { readState } from "../state";
import { c, ui, writeOut } from "../ui";
import { VERSION } from "../version";
import { listWorkspaces } from "../workspaces";
import { describe } from "./meta";

export function repoState() {
  const st = status();
  const state = readState();
  const journal = readJournal();
  const live = journal.filter((e) => !e.undone);
  const remote = mainRemote();
  return {
    gitbuddy_version: VERSION,
    repo: repoRoot(),
    head: head(),
    branch: currentBranch(),
    detached: !currentBranch(),
    default_branch: defaultBranch(),
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    remote: remote ? { name: remote, url: remoteUrl(remote) } : null,
    workspace: state.active ?? null,
    workspaces: listWorkspaces().map((w) => ({ name: w.name, slug: w.slug, active: w.active, updated: w.updated })),
    clean: st.clean,
    changes: st.files.map((f) => ({ path: f.path, from: f.from, kind: f.kind })),
    conflicts: st.conflicted.map((f) => f.path),
    operation: operation(),
    away: state.away ?? null,
    last_snapshot: live.length ? { id: live[live.length - 1].id, label: live[live.length - 1].label, time: live[live.length - 1].time } : null,
    can_undo: live.length > 0,
    can_redo: journal.some((e) => e.redo),
  };
}

define({
  name: "state",
  aliases: ["where"],
  group: "agent",
  summary: "Everything about this project in one go (great with --json)",
  examples: ["gitbuddy state --json"],
  run() {
    const s = repoState();
    ctx.data = s;
    ui.line(`${c.bold("branch")}     ${s.branch ?? c.warn("(looking at an old save)")}${s.upstream ? c.dim(` ↔ ${s.upstream} (+${s.ahead}/-${s.behind})`) : ""}`);
    ui.line(`${c.bold("workspace")}  ${s.workspace ?? c.dim("none")}  ${c.dim(`(${s.workspaces.length} total)`)}`);
    ui.line(`${c.bold("changes")}    ${s.changes.length}${s.conflicts.length ? c.err(` · ${s.conflicts.length} clashing`) : ""}`);
    ui.line(`${c.bold("remote")}     ${s.remote ? `${s.remote.name} ${c.dim(s.remote.url ?? "")}` : c.dim("none")}`);
    ui.line(`${c.bold("undo")}       ${s.last_snapshot ? s.last_snapshot.label : c.dim("nothing yet")}`);
  },
});

const MCP_EXCLUDE = new Set(["mcp", "git", "learn", "setup", "update", "completion", "prompt", "when-broke", "__complete"]);

export function mcpCommands(): CommandDef[] {
  return allCommands().filter((d) => !d.hidden && !d.interactiveOnly && !MCP_EXCLUDE.has(d.name));
}

define({
  name: "commands",
  group: "agent",
  summary: "A machine-readable list of every command (use --json)",
  needsRepo: false,
  examples: ["gitbuddy commands --json"],
  run() {
    const list = allCommands().filter((d) => !d.hidden).map(describe);
    ctx.data = { version: VERSION, commands: list, exit_codes: { 0: "ok", 1: "user error", 2: "conflict needs a human", 3: "setup: git missing or not a repo", 4: "network or login" } };
    ui.table(list.map((d) => [c.accent(d.name), d.mutates ? (d.destructive ? c.err("destructive") : c.warn("changes")) : c.dim("read-only"), d.summary]));
  },
});

const toolName = (name: string) => `gitbuddy_${name.replace(/-/g, "_")}`;

export function toolSchema(def: CommandDef) {
  const properties: Record<string, unknown> = {
    cwd: { type: "string", description: "Folder of the git project (defaults to where the server started)" },
  };
  const required: string[] = [];
  for (const a of def.args ?? []) {
    properties[a.name] = a.variadic ? { type: "string", description: `${a.description} (several: separate with spaces)` } : { type: "string", description: a.description };
    if (a.required) required.push(a.name);
  }
  for (const [k, o] of Object.entries(def.options ?? {})) {
    if (k === "edit") continue;
    properties[k] = o.type === "boolean" ? { type: "boolean", description: o.description } : o.type === "list" ? { type: "array", items: { type: "string" }, description: o.description } : { type: "string", description: o.description };
  }
  if (def.destructive || def.mutates) properties.yes = { type: "boolean", description: "Confirm actions that would normally ask a question" };
  properties.dry_run = { type: "boolean", description: "Only show what would happen" };
  return {
    name: toolName(def.name),
    title: def.summary,
    description: `${def.summary}.${def.gitEquivalent ? ` (git: ${def.gitEquivalent})` : ""}${def.undoable ? " Undoable with gitbuddy_undo using the returned snapshot_id." : ""}${def.destructive ? " Destructive: asks for yes=true." : ""}`,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: {
      title: def.summary,
      readOnlyHint: !def.mutates,
      destructiveHint: Boolean(def.destructive),
      idempotentHint: !def.mutates,
      openWorldHint: Boolean(def.network),
    },
  };
}

export function argvFor(def: CommandDef, input: Record<string, unknown>): string[] {
  const argv = [def.name];
  for (const a of def.args ?? []) {
    const v = input[a.name];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) argv.push(...v.map(String));
    else if (a.variadic && a.name === "files") argv.push(...String(v).split(/\s+/).filter(Boolean));
    else argv.push(String(v));
  }
  for (const [k, o] of Object.entries(def.options ?? {})) {
    const v = input[k];
    if (v === undefined || v === null || k === "edit") continue;
    if (o.type === "boolean") {
      if (v) argv.push(`--${k}`);
    } else if (o.type === "list") for (const item of Array.isArray(v) ? v : [v]) argv.push(`--${k}`, String(item));
    else argv.push(`--${k}`, String(v));
  }
  if (input.yes) argv.push("--yes");
  if (input.dry_run) argv.push("--dry-run");
  argv.push("--json");
  return argv;
}

const INSTRUCTIONS = `gitbuddy is a safe, human-friendly layer over git.
- Call gitbuddy_state first to see branch, workspace, changes and conflicts.
- Every changing tool returns snapshot_id; gitbuddy_undo (which=<snapshot_id>) rolls it back.
- Exit/error codes: conflict (needs gitbuddy_conflicts + gitbuddy_keep + gitbuddy_continue), needs_confirmation (retry with yes=true), no_remote, auth_failed.
- Workspaces let you juggle tasks without branches: gitbuddy_work, gitbuddy_switch, gitbuddy_list.`;

define({
  name: "mcp",
  group: "agent",
  summary: "Run gitbuddy as an MCP server so AI agents can use it",
  needsRepo: false,
  examples: ["claude mcp add gitbuddy -- gitbuddy mcp"],
  async run() {
    const startDir = process.cwd();
    const tools = mcpCommands();
    const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
    const handle = async (line: string) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      if (msg.id === undefined || msg.id === null) return;
      const reply = (result: unknown) => send({ jsonrpc: "2.0", id: msg.id, result });
      switch (msg.method) {
        case "initialize":
          return reply({
            protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "gitbuddy", title: "gitbuddy", version: VERSION },
            instructions: INSTRUCTIONS,
          });
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: tools.map(toolSchema) });
        case "tools/call": {
          const name = String(msg.params?.name ?? "");
          const def = tools.find((t) => toolName(t.name) === name);
          if (!def) return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          const input = (msg.params?.arguments ?? {}) as Record<string, unknown>;
          let result: RunResult;
          try {
            process.chdir(typeof input.cwd === "string" && input.cwd ? input.cwd : startDir);
            result = await execute(argvFor(def, input), { forceAgent: true });
          } catch (e) {
            return reply({ content: [{ type: "text", text: `gitbuddy error: ${(e as Error).message}` }], isError: true });
          } finally {
            process.chdir(startDir);
          }
          return reply({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok });
        }
        default:
          return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
      }
    };
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of Bun.stdin.stream()) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) await handle(line);
      }
    }
    if (buf.trim()) await handle(buf.trim());
  },
});

const WORKSPACE_ARGS = new Set(["switch", "peek", "drop", "rename"]);

define({
  name: "__complete",
  group: "agent",
  summary: "Shell completion helper",
  hidden: true,
  needsRepo: false,
  rawArgs: true,
  run({ args }) {
    const words = args.filter((w) => w !== "");
    let out: string[] = [];
    if (!words.length) out = allCommands().filter((d) => !d.hidden).flatMap((d) => [d.name, ...(d.aliases ?? [])]);
    else {
      const def = findCommand(words[0]);
      const inRepo = Boolean(repoRoot());
      if (def && WORKSPACE_ARGS.has(def.name) && inRepo) out = listWorkspaces().map((w) => w.slug);
      else if (def?.name === "help") out = allCommands().filter((d) => !d.hidden).map((d) => d.name);
      else if (def?.name === "keep") out = words.length === 1 ? ["mine", "theirs", "both"] : inRepo ? status().conflicted.map((f) => f.path) : [];
      else if (def?.name === "completion") out = ["bash", "zsh", "fish", "powershell"];
      else if (def?.name === "config") out = words.length === 1 ? ["set", "get"] : ["theme", "fun", "emoji", "ai_command", "autosave_minutes", "update_check"];
      else if (def?.name === "restore" && inRepo) out = (tryOut(["for-each-ref", "--format=%(contents:subject)", "refs/gitbuddy/trash/"]) ?? "").split("\n").map((l) => l.replace(/^gitbuddy work: /, "")).filter(Boolean);
      else if (def?.options) out = Object.keys(def.options).map((k) => `--${k}`);
    }
    if (!ctx.flags.json) writeOut(out.join("\n") + (out.length ? "\n" : ""));
    ctx.data = { completions: out };
  },
});

