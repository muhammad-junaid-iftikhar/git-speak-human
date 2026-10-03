import { describe, expect, test } from "bun:test";
import { Sandbox } from "./helpers";

describe("fun & profile", () => {
  test("achievements and stats are tracked", () => {
    const s = new Sandbox().init();
    s.env.GITBUDDY_TRACK = "1";
    s.write("a.txt", "a\n");
    s.run("done", "first");
    const me = s.run("me").json.data;
    expect(me.counts.done).toBe(1);
    expect(me.achievements).toContain("first_save");
    expect(me.streak).toBe(1);
    expect(me.level.level).toBeGreaterThanOrEqual(1);
  });

  test("config set/get and theme validation", () => {
    const s = new Sandbox();
    expect(s.run("config", "set", "theme", "pirate").json.data.theme).toBe("pirate");
    expect(s.run("config", "get", "theme").json.data.theme).toBe("pirate");
    expect(s.run("config", "set", "theme", "ugly").json.ok).toBe(false);
    expect(s.run("config", "set", "fun", "false").json.data.fun).toBe(false);
    expect(s.run("config", "set", "nope", "1").json.error.code).toBe("bad_setting");
  });

  test("completion scripts and the completion helper", () => {
    const s = new Sandbox().init();
    for (const sh of ["bash", "zsh", "fish", "powershell"]) expect(s.run("completion", sh).json.data.script).toContain("__complete");
    s.run("work", "dark mode");
    expect(s.human("__complete", "switch").stdout).toContain("dark-mode");
    expect(s.human("__complete").stdout).toContain("done");
  });

  test("prompt segment", () => {
    const s = new Sandbox().init();
    s.run("work", "ui");
    s.write("x", "x");
    expect(s.human("prompt").stdout).toContain("ui");
    expect(s.run("prompt").json.data.workspace).toBe("ui");
  });

  test("interactive-only commands refuse politely without a terminal", () => {
    const s = new Sandbox();
    expect(s.run("learn").json.error.code).toBe("interactive_only");
  });

  test("no two commands share a name", () => {
    const s = new Sandbox();
    const cmds = s.run("commands").json.data.commands;
    const names = cmds.flatMap((c: any) => [c.name, ...c.aliases]);
    expect(new Set(names).size).toBe(names.length);
  });
});
