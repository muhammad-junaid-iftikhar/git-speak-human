import { describe, expect, test } from "bun:test";
import { Sandbox } from "./helpers";

describe("basics", () => {
  test("help works outside a repo and lists commands", () => {
    const s = new Sandbox();
    const r = s.run("help");
    expect(r.code).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.data.commands.map((c: any) => c.name)).toContain("work");
  });

  test("outside a repo explains how to start", () => {
    const s = new Sandbox();
    const r = s.run("show");
    expect(r.code).toBe(3);
    expect(r.json.error.code).toBe("not_a_repo");
  });

  test("unknown command suggests a close one", () => {
    const s = new Sandbox().init();
    const r = s.run("sned");
    expect(r.code).toBe(1);
    expect(r.json.error.hint).toContain("send");
  });

  test("bad option is a friendly error", () => {
    const s = new Sandbox().init();
    const r = s.run("show", "--nope");
    expect(r.json.error.code).toBe("bad_option");
  });
});

describe("done", () => {
  test("messages with quotes and $() are stored literally, nothing runs", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    const msg = "it's $(touch pwned) `touch pwned2`";
    const r = s.run("done", msg);
    expect(r.code).toBe(0);
    expect(s.git("log", "-1", "--format=%s")).toBe(msg);
    expect(s.exists("pwned")).toBe(false);
    expect(s.exists("pwned2")).toBe(false);
  });

  test("includes new files and reports nothing to save when clean", () => {
    const s = new Sandbox().init();
    s.write("dir/new.txt", "x\n");
    expect(s.run("done", "add").json.data.files).toEqual(["dir/new.txt"]);
    expect(s.run("done", "again").json.data.saved).toBe(false);
  });

  test("--only saves just those files", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    s.write("b.txt", "b\n");
    s.run("done", "only a", "--only", "a.txt");
    expect(s.git("show", "--name-only", "--format=", "HEAD")).toBe("a.txt");
    expect(s.git("status", "--porcelain")).toContain("b.txt");
  });

  test("suggests a message when none is given", () => {
    const s = new Sandbox().init();
    s.write("login.ts", "x\n");
    const r = s.run("done");
    expect(r.json.data.message).toBe("Add login.ts");
  });

  test("blocks secrets", () => {
    const s = new Sandbox().init();
    s.write(".env", "TOKEN=abc\n");
    const r = s.run("done", "oops");
    expect(r.code).toBe(1);
    expect(r.json.error.code).toBe("secrets_found");
    expect(s.git("log", "--oneline").split("\n").length).toBe(1);
    s.write("config.ts", "const k = 'ghp_" + "a".repeat(36) + "'\n");
    s.write(".gitignore", ".env\n");
    expect(s.run("done", "key").json.error.code).toBe("secrets_found");
    expect(s.run("done", "key", "--allow-secrets").json.ok).toBe(true);
  });

  test(".env.example is fine", () => {
    const s = new Sandbox().init();
    s.write(".env.example", "TOKEN=\n");
    expect(s.run("done", "example").json.ok).toBe(true);
  });
});

describe("dry run and explain", () => {
  test("--dry-run changes nothing", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    const r = s.run("done", "x", "--dry-run");
    expect(r.code).toBe(0);
    expect(s.git("log", "--oneline").split("\n").length).toBe(1);
  });

  test("--explain shows the real git commands", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    const r = s.human("done", "x", "--explain");
    expect(r.stderr).toContain("git commit");
  });
});

describe("version", () => {
  test("--version, -v and version all work", () => {
    const s = new Sandbox();
    const pkg = require("../package.json");
    expect(s.run("--version").json.data.version).toBe(pkg.version);
    expect(s.human("-v", "--short").stdout.trim()).toBe(pkg.version);
    expect(s.run("version").json.data.git).toBeTruthy();
  });
});
