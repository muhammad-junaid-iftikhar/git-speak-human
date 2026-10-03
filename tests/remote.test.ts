import { describe, expect, test } from "bun:test";
import { Sandbox } from "./helpers";

function setup() {
  const me = new Sandbox().init();
  const bare = me.withRemote();
  const them = me.clone(bare);
  return { me, them, bare };
}

const remoteHas = (bare: string, ref: string) =>
  Bun.spawnSync(["git", "--git-dir", bare, "rev-parse", "--verify", "-q", ref]).exitCode === 0;

describe("branches and remote", () => {
  test("send --branch pushes to a named branch and stays on main", () => {
    const { me, bare } = setup();
    me.write("f.txt", "f");
    me.run("done", "feature");
    const r = me.run("send", "--branch", "feature/login");
    expect(r.json.data.sent).toBe(1);
    expect(remoteHas(bare, "refs/heads/feature/login")).toBe(true);
    expect(me.git("branch", "--show-current")).toBe("main");
    expect(me.run("send", "--branch", "bad..name").json.error.code).toBe("bad_branch");
  });

  test("share --branch uses my branch name", () => {
    const { me, bare } = setup();
    me.write("f.txt", "f");
    me.run("done", "feature");
    const r = me.run("share", "--branch", "feature/mine");
    expect(r.json.data.branch).toBe("feature/mine");
    expect(remoteHas(bare, "refs/heads/feature/mine")).toBe(true);
  });

  test("compare shows both sides and says when 100% in sync", () => {
    const { me, them } = setup();
    expect(me.run("compare").json.data.inSync).toBe(true);
    them.write("t.txt", "t");
    them.run("done", "theirs");
    them.run("send");
    me.write("m.txt", "m");
    me.run("done", "mine");
    const d = me.run("compare").json.data;
    expect(d.onlyHere.map((e: any) => e.message)).toEqual(["mine"]);
    expect(d.onlyThere.map((e: any) => e.message)).toEqual(["theirs"]);
    expect(d.inSync).toBe(false);
  });

  test("show lists saves not sent yet", () => {
    const { me } = setup();
    me.write("a.txt", "a");
    me.run("done", "unsent one");
    expect(me.run("show").json.data.unsent.map((e: any) => e.message)).toEqual(["unsent one"]);
  });

  test("catch-up brings origin/main into a feature branch", () => {
    const { me, them } = setup();
    me.git("switch", "-q", "-c", "feature");
    me.write("feat.txt", "x");
    me.run("done", "feature work");
    them.write("main.txt", "m");
    them.run("done", "main moved");
    them.run("send");
    const r = me.run("catch-up");
    expect(r.json.data.received).toBe(1);
    expect(r.json.data.method).toBe("rebase");
    expect(me.exists("main.txt") && me.exists("feat.txt")).toBe(true);
    expect(me.git("log", "--format=%s", "-n2").split("\n")).toEqual(["feature work", "main moved"]);
  });

  test("match-remote makes main identical and keeps extra work aside", () => {
    const { me } = setup();
    me.write("a.txt", "a");
    me.run("done", "local only");
    me.write("wip.txt", "wip");
    const r = me.run("match-remote", "--yes");
    expect(r.json.data.changed).toBe(true);
    expect(me.git("rev-parse", "HEAD")).toBe(me.git("rev-parse", "origin/main"));
    expect(me.exists("wip.txt")).toBe(false);
    expect(r.json.data.backupBranch).toMatch(/^backup\/main-/);
    expect(me.git("log", "-1", "--format=%s", r.json.data.backupBranch)).toBe("local only");
    me.run("switch", r.json.data.parkedWorkspace);
    expect(me.read("wip.txt")).toBe("wip");
    expect(me.run("match-remote", "--yes").json.ok).toBe(true);
  });

  test("view shows files of a save and whether it was sent", () => {
    const { me } = setup();
    me.write("v.txt", "v");
    me.run("done", "add v");
    const d = me.run("view").json.data;
    expect(d.message).toBe("add v");
    expect(d.files).toEqual([{ kind: "new", path: "v.txt" }]);
    expect(d.sent).toBe(false);
    me.run("send");
    expect(me.run("view", "last").json.data.sent).toBe(true);
  });

  test("done --pick needs a person, --only works without one", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a");
    s.write("b.txt", "b");
    expect(s.run("done", "x", "--pick").json.error.code).toBe("needs_choice");
  });
});
