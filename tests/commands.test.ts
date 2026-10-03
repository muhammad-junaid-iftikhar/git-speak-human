import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "./helpers";

function saves(s: Sandbox): string[] {
  return s.git("log", "--format=%s").split("\n");
}

describe("starting", () => {
  test("new makes a repo with a smart .gitignore and a first save", () => {
    const s = new Sandbox();
    s.write("package.json", "{}\n");
    const r = s.run("new", "--save");
    expect(r.json.data.detected).toContain("node");
    expect(s.read(".gitignore")).toContain("node_modules/");
    expect(saves(s)).toEqual(["First save"]);
    expect(s.git("branch", "--show-current")).toBe("main");
  });

  test("new <folder> creates it", () => {
    const s = new Sandbox();
    expect(s.run("new", "app").json.data.created).toBe(true);
    expect(existsSync(join(s.cwd, "app", ".git"))).toBe(true);
  });

  test("copy and connect", () => {
    const s = new Sandbox().init();
    const bare = s.withRemote();
    const other = new Sandbox();
    const r = other.run("copy", bare, "copied");
    expect(r.json.ok).toBe(true);
    expect(existsSync(join(other.cwd, "copied", "readme.md"))).toBe(true);
    const fresh = new Sandbox().init();
    expect(fresh.run("connect", bare).json.data.changed).toBe(true);
    expect(fresh.git("remote", "get-url", "origin")).toBe(bare);
  });
});

describe("history tools", () => {
  test("history filters by file and person", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "1\n");
    s.run("done", "touch a");
    s.write("b.txt", "1\n");
    s.run("done", "touch b");
    const all = s.run("history").json.data.entries;
    expect(all.map((e: any) => e.message)).toEqual(["touch b", "touch a", "start"]);
    expect(s.run("history", "a.txt").json.data.entries.map((e: any) => e.message)).toEqual(["touch a"]);
    expect(s.run("history", "--by", "nobody").json.data.entries).toEqual([]);
  });

  test("who knows who wrote a line", () => {
    const s = new Sandbox().init();
    const r = s.run("who", "readme.md:1");
    expect(r.json.data.author).toBe("Tess Ter");
    expect(r.json.data.message).toBe("start");
  });

  test("find searches now and in history", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "secret sauce\n");
    s.run("done", "add sauce");
    s.write("a.txt", "nothing\n");
    s.run("done", "remove sauce");
    const d = s.run("find", "sauce").json.data;
    expect(d.now).toEqual([]);
    expect(d.history.map((e: any) => e.message)).toEqual(["remove sauce", "add sauce"]);
  });

  test("go-back restores a file from 2 saves ago, and undo reverts it", () => {
    const s = new Sandbox().init();
    s.write("f.txt", "v1\n");
    s.run("done", "v1");
    s.write("f.txt", "v2\n");
    s.run("done", "v2");
    s.write("f.txt", "v3\n");
    s.run("done", "v3");
    s.run("go-back", "f.txt", "to", "2 saves ago");
    expect(s.read("f.txt")).toBe("v1\n");
    s.run("undo");
    expect(s.read("f.txt")).toBe("v3\n");
  });

  test("time-travel and back keep unsaved work", () => {
    const s = new Sandbox().init();
    s.write("new.txt", "later\n");
    s.run("done", "later");
    s.write("wip.txt", "wip\n");
    const r = s.run("time-travel", "1 save ago");
    expect(r.json.ok).toBe(true);
    expect(s.exists("new.txt")).toBe(false);
    expect(s.exists("wip.txt")).toBe(false);
    expect(s.run("state").json.data.away.kind).toBe("time-travel");
    expect(s.run("done", "nope").json.ok).toBe(false);
    s.run("back");
    expect(s.exists("new.txt")).toBe(true);
    expect(s.read("wip.txt")).toBe("wip\n");
    expect(s.git("branch", "--show-current")).toBe("main");
  });

  test("when-broke finds the bad save with a test command", () => {
    const s = new Sandbox().init();
    s.git("tag", "good");
    for (let i = 1; i <= 6; i++) {
      s.write(`f${i}.txt`, `${i}\n`);
      if (i === 4) s.write("broken", "yes\n");
      s.run("done", `step ${i}`);
    }
    s.env.GITBUDDY_DEBUG = "1";
    const r = s.run("when-broke", "--good", "good", "--run", "test ! -f broken");
    if (r.json?.data?.message !== "step 4") console.log("when-broke debug:", r.stdout, r.stderr, s.git("log", "--oneline"));
    expect(r.json.data.message).toBe("step 4");
    expect(s.git("branch", "--show-current")).toBe("main");
  });
});

describe("fixing mistakes", () => {
  test("throw-away then undo", () => {
    const s = new Sandbox().init();
    s.write("readme.md", "changed\n");
    s.write("junk.txt", "junk\n");
    s.run("throw-away", "--yes");
    expect(s.read("readme.md")).toBe("hello\n");
    expect(s.exists("junk.txt")).toBe(false);
    s.run("undo");
    expect(s.read("readme.md")).toBe("changed\n");
    expect(s.exists("junk.txt")).toBe(true);
  });

  test("throw-away one file only", () => {
    const s = new Sandbox().init();
    s.write("readme.md", "changed\n");
    s.write("keep.txt", "keep\n");
    s.run("throw-away", "readme.md", "--yes");
    expect(s.read("readme.md")).toBe("hello\n");
    expect(s.exists("keep.txt")).toBe(true);
  });

  test("unsave keeps changes", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    s.run("done", "oops");
    s.run("unsave");
    expect(saves(s)).toEqual(["start"]);
    expect(s.read("a.txt")).toBe("a\n");
  });

  test("reverse makes a cancelling save", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    s.run("done", "add a");
    s.run("reverse", "last");
    expect(s.exists("a.txt")).toBe(false);
    expect(saves(s)[0]).toContain("Revert");
  });

  test("ignore untracks already-saved files", () => {
    const s = new Sandbox().init();
    s.write("debug.log", "x\n");
    s.run("done", "log");
    const r = s.run("ignore", "*.log");
    expect(r.json.data.untracked).toEqual(["debug.log"]);
    expect(s.read(".gitignore")).toContain("*.log");
    expect(s.exists("debug.log")).toBe(true);
  });

  test("fix-last renames the last save", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    s.run("done", "typo");
    s.run("fix-last", "fixed message");
    expect(saves(s)[0]).toBe("fixed message");
  });
});

describe("teamwork", () => {
  test("combine with a clash, keep both, continue", () => {
    const s = new Sandbox().init();
    s.git("switch", "-q", "-c", "other");
    s.write("readme.md", "other\n");
    s.run("done", "other");
    s.git("switch", "-q", "main");
    s.write("readme.md", "main\n");
    s.run("done", "main");
    expect(s.run("combine", "other").code).toBe(2);
    s.run("keep", "both", "readme.md");
    expect(s.run("continue").code).toBe(0);
    expect(s.read("readme.md")).toBe("main\nother\n");
  });

  test("grab copies one save", () => {
    const s = new Sandbox().init();
    s.git("switch", "-q", "-c", "other");
    s.write("g.txt", "g\n");
    s.run("done", "grab me");
    const id = s.git("rev-parse", "HEAD");
    s.git("switch", "-q", "main");
    s.run("grab", id);
    expect(s.read("g.txt")).toBe("g\n");
  });

  test("tidy squash, reword and drop", () => {
    const s = new Sandbox().init();
    for (const n of ["one", "two", "three", "four"]) {
      s.write(`${n}.txt`, n);
      s.run("done", n);
    }
    const two = s.git("rev-parse", "HEAD~2");
    s.run("tidy", "reword", two, "TWO");
    expect(saves(s)).toEqual(["four", "three", "TWO", "one", "start"]);
    const three = s.git("rev-parse", "HEAD~1");
    s.run("tidy", "drop", three);
    expect(saves(s)).toEqual(["four", "TWO", "one", "start"]);
    expect(s.exists("three.txt")).toBe(false);
    s.run("tidy", "squash", "3", "all in one");
    expect(saves(s)).toEqual(["all in one", "start"]);
    expect(s.exists("four.txt") && s.exists("one.txt")).toBe(true);
  });

  test("tidy refuses sent saves", () => {
    const s = new Sandbox().init();
    s.withRemote();
    s.write("a", "a");
    s.run("done", "a");
    s.run("send");
    expect(s.run("tidy", "drop", "HEAD").json.error.code).toBe("already_pushed");
  });

  test("share from main moves saves to a branch and pushes it", () => {
    const s = new Sandbox().init();
    const bare = s.withRemote();
    s.write("feat.txt", "f\n");
    s.run("done", "Add feature");
    const r = s.run("share");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.branch).toBe("share/add-feature");
    expect(s.git("branch", "--show-current")).toBe("main");
    expect(s.git("rev-parse", "main")).toBe(s.git("rev-parse", "origin/main"));
    const p = Bun.spawnSync(["git", "--git-dir", bare, "rev-parse", "--verify", "refs/heads/share/add-feature"]);
    expect(p.exitCode).toBe(0);
  });
});

describe("releases", () => {
  test("release writes changelog, bumps package.json and tags", () => {
    const s = new Sandbox().init();
    s.write("package.json", '{\n  "name": "x",\n  "version": "0.0.1"\n}\n');
    s.run("done", "Add package");
    s.write("a.txt", "a");
    s.run("done", "Add a");
    const r = s.run("release", "1.0.0");
    expect(r.json.data.tag).toBe("v1.0.0");
    expect(s.read("CHANGELOG.md")).toContain("## v1.0.0");
    expect(s.read("CHANGELOG.md")).toContain("- Add a");
    expect(s.read("package.json")).toContain('"version": "1.0.0"');
    expect(s.run("versions").json.data.versions[0].name).toBe("v1.0.0");
    expect(s.run("release", "1.0.0").json.ok).toBe(false);
  });

  test("clean-up removes merged branches", () => {
    const s = new Sandbox().init();
    s.git("branch", "old-feature");
    const r = s.run("clean-up", "--yes");
    expect(r.json.data.deletedBranches).toEqual(["old-feature"]);
  });

  test("git passthrough", () => {
    const s = new Sandbox().init();
    expect(s.human("git", "rev-parse", "--is-inside-work-tree").stdout.trim()).toBe("true");
  });
});

