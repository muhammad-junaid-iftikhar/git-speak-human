import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Sandbox } from "./helpers";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function mcp(s: Sandbox, messages: unknown[]): any[] {
  const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const p = Bun.spawnSync(["bun", CLI, "mcp"], { cwd: s.cwd, env: s.env, stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe" });
  return p.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("agent mode", () => {
  test("state --json has everything an agent needs", () => {
    const s = new Sandbox().init();
    s.run("work", "task");
    s.write("x.txt", "x\n");
    const d = s.run("state").json.data;
    expect(d.branch).toBe("main");
    expect(d.workspace).toBe("task");
    expect(d.changes[0].path).toBe("x.txt");
    expect(d.can_undo).toBe(true);
  });

  test("commands --json lists side effects", () => {
    const s = new Sandbox();
    const cmds = s.run("commands").json.data.commands;
    const drop = cmds.find((c: any) => c.name === "drop");
    expect(drop.destructive).toBe(true);
    expect(cmds.find((c: any) => c.name === "show").mutates).toBe(false);
  });

  test("changing commands return a snapshot id usable for undo", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    const r = s.run("done", "a");
    expect(typeof r.json.snapshot_id).toBe("string");
    expect(s.run("undo", r.json.snapshot_id).json.ok).toBe(true);
    expect(s.git("log", "--oneline").split("\n").length).toBe(1);
  });

  test("never prompts without a terminal", () => {
    const s = new Sandbox().init();
    s.run("work", "a");
    s.run("work", "b");
    expect(s.run("drop", "a").json.error.code).toBe("needs_confirmation");
    expect(s.run("switch").json.error.code).toBe("needs_choice");
  });
});

describe("mcp server", () => {
  test("handshake, list tools and call one", () => {
    const s = new Sandbox().init();
    s.write("y.txt", "y\n");
    const out = mcp(s, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "gitbuddy_done", arguments: { message: "from agent" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "gitbuddy_nope", arguments: {} } },
    ]);
    expect(out.length).toBe(4);
    expect(out[0].result.serverInfo.name).toBe("gitbuddy");
    const names = out[1].result.tools.map((t: any) => t.name);
    expect(names).toContain("gitbuddy_undo");
    expect(names).not.toContain("gitbuddy_mcp");
    expect(out[2].result.isError).toBe(false);
    expect(out[2].result.structuredContent.data.message).toBe("from agent");
    expect(out[3].error.code).toBe(-32602);
    expect(s.git("log", "-1", "--format=%s")).toBe("from agent");
  });
});
