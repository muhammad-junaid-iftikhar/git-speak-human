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

describe("send handles team changes and protected branches", () => {
  test("send gets teammates' saves first, then sends yours on top", () => {
    const { me, them } = setup();
    them.write("t.txt", "t");
    them.run("done", "theirs");
    them.run("send");
    me.write("m.txt", "m");
    me.run("done", "mine");
    const r = me.run("send");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.caughtUp).toBe(1);
    expect(me.git("log", "--format=%s", "-n3").split("\n")).toEqual(["mine", "theirs", "start"]);
    expect(me.run("compare").json.data.inSync).toBe(true);
  });

  test("a protected branch rejection turns into a pull request branch", () => {
    const { me, bare } = setup();
    const hook = `${bare}/hooks/pre-receive`;
    require("node:fs").writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do [ "$ref" = refs/heads/main ] && { echo "GH006: Protected branch update failed for refs/heads/main." >&2; exit 1; }; done; exit 0\n');
    require("node:fs").chmodSync(hook, 0o755);
    me.write("p.txt", "p");
    me.run("done", "Protected change");
    const r = me.run("send");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.viaPullRequest).toBe(true);
    expect(r.json.data.branch).toBe("share/protected-change");
    expect(remoteHas(bare, "refs/heads/share/protected-change")).toBe(true);
    expect(me.git("branch", "--show-current")).toBe("main");
    expect(me.git("rev-parse", "main")).toBe(me.git("rev-parse", "origin/main"));
    expect(me.run("protect").json.data.protected).toEqual(["main"]);
  });

  test("protect marks a branch up front", () => {
    const { me, bare } = setup();
    me.run("protect", "main");
    me.write("q.txt", "q");
    me.run("done", "Go via PR");
    expect(me.run("send").json.data.viaPullRequest).toBe(true);
    expect(remoteHas(bare, "refs/heads/share/go-via-pr")).toBe(true);
    me.run("protect", "main", "--remove");
    expect(me.run("protect").json.data.protected).toEqual([]);
  });
});

describe("try someone's branch", () => {
  function withTeamBranch() {
    const { me, them, bare } = setup();
    them.git("switch", "-q", "-c", "feature/x");
    them.write("x.txt", "feature x\n");
    them.run("done", "Feature X");
    them.git("push", "-q", "-u", "origin", "feature/x");
    return { me, them, bare };
  }

  test("try switches to a copy, tucks my work, back restores it", () => {
    const { me } = withTeamBranch();
    me.write("mine.txt", "wip\n");
    const r = me.run("try", "feature/x");
    expect(r.json.ok).toBe(true);
    expect(me.git("branch", "--show-current")).toBe("try/feature/x");
    expect(me.read("x.txt")).toBe("feature x\n");
    expect(me.exists("mine.txt")).toBe(false);
    expect(me.run("state").json.data.away.kind).toBe("try");
    me.run("back");
    expect(me.git("branch", "--show-current")).toBe("main");
    expect(me.read("mine.txt")).toBe("wip\n");
    expect(me.exists("x.txt")).toBe(false);
  });

  test("try --folder makes a separate copy and leaves my work alone", () => {
    const { me } = withTeamBranch();
    me.write("mine.txt", "wip\n");
    const r = me.run("try", "feature/x", "--folder");
    const dir = r.json.data.folder;
    expect(require("node:fs").readFileSync(`${dir}/x.txt`, "utf-8")).toBe("feature x\n");
    expect(me.read("mine.txt")).toBe("wip\n");
    expect(me.git("branch", "--show-current")).toBe("main");
    expect(me.run("try", "--clean-up").json.data.removedFolders).toEqual([dir]);
    expect(require("node:fs").existsSync(dir)).toBe(false);
  });

  test("try --refresh gets new saves on that branch", () => {
    const { me, them } = withTeamBranch();
    me.run("try", "feature/x");
    them.write("x2.txt", "more\n");
    them.run("done", "More X");
    them.git("push", "-q");
    me.run("try", "--refresh");
    expect(me.read("x2.txt")).toBe("more\n");
  });

  test("try without a name lists branches; unknown name suggests", () => {
    const { me } = withTeamBranch();
    expect(me.run("try").json.data.branches.map((b: any) => b.name)).toContain("feature/x");
    expect(me.run("try", "feature").json.error.hint).toContain("feature/x");
  });
});
