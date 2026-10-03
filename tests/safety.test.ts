import { describe, expect, test } from "bun:test";
import { Sandbox } from "./helpers";

describe("undo / redo", () => {
  test("undo a save keeps the changes, redo brings the save back", () => {
    const s = new Sandbox().init();
    s.write("a.txt", "a\n");
    s.run("done", "add a");
    expect(s.run("undo").code).toBe(0);
    expect(s.git("log", "--oneline").split("\n").length).toBe(1);
    expect(s.read("a.txt")).toBe("a\n");
    s.run("redo");
    expect(s.git("log", "-1", "--format=%s")).toBe("add a");
  });

  test("undo a workspace switch puts files back", () => {
    const s = new Sandbox().init();
    s.run("work", "one");
    s.write("one.txt", "1\n");
    s.run("work", "two");
    expect(s.exists("one.txt")).toBe(false);
    s.run("undo");
    expect(s.exists("one.txt")).toBe(true);
  });

  test("undo a finished workspace brings it back", () => {
    const s = new Sandbox().init();
    s.run("work", "feature");
    s.write("f.txt", "f\n");
    expect(s.run("done", "feature done").json.data.finishedWorkspace).toBe("feature");
    s.run("undo");
    expect(s.run("list").json.data.workspaces.map((w: any) => w.name)).toContain("feature");
  });

  test("undo --list and nothing to undo", () => {
    const s = new Sandbox().init();
    expect(s.run("undo").json.error.code).toBe("nothing_to_undo");
    s.write("a.txt", "a\n");
    s.run("done", "a");
    expect(s.run("undo", "--list").json.data.entries.length).toBe(1);
  });

  test("refuses to undo saves that were already sent", () => {
    const s = new Sandbox().init();
    s.withRemote();
    s.write("a.txt", "a\n");
    s.run("done", "a");
    s.run("send");
    const r = s.run("undo");
    expect(r.json.error.code).toBe("already_pushed");
  });
});

describe("team flow", () => {
  test("send, get and conflicts end to end", () => {
    const me = new Sandbox().init();
    const bare = me.withRemote();
    const them = me.clone(bare);
    them.write("readme.md", "theirs\n");
    them.run("done", "their change");
    expect(them.run("send").json.data.sent).toBe(1);

    me.write("readme.md", "mine\n");
    me.run("done", "my change");
    const got = me.run("get");
    expect(got.code).toBe(2);
    expect(got.json.error.code).toBe("conflict");

    const c = me.run("conflicts");
    expect(c.json.data.files[0].path).toBe("readme.md");
    me.run("keep", "mine", "readme.md");
    expect(me.run("continue").code).toBe(0);
    expect(me.read("readme.md")).toBe("mine\n");
    expect(me.git("log", "--format=%s").split("\n")).toEqual(["my change", "their change", "start"]);
    expect(me.run("send").json.data.sent).toBe(1);
  });

  test("get with unsaved changes keeps them", () => {
    const me = new Sandbox().init();
    const bare = me.withRemote();
    const them = me.clone(bare);
    them.write("other.txt", "o\n");
    them.run("done", "other");
    them.run("send");
    me.write("wip.txt", "wip\n");
    expect(me.run("get").json.data.received).toBe(1);
    expect(me.read("wip.txt")).toBe("wip\n");
    expect(me.exists("other.txt")).toBe(true);
  });

  test("send without a remote explains how to connect", () => {
    const s = new Sandbox().init();
    expect(s.run("send").json.error.code).toBe("no_remote");
  });

  test("abort cancels a clashing get", () => {
    const me = new Sandbox().init();
    const bare = me.withRemote();
    const them = me.clone(bare);
    them.write("readme.md", "theirs\n");
    them.run("done", "t");
    them.run("send");
    me.write("readme.md", "mine\n");
    me.run("done", "m");
    me.run("get");
    expect(me.run("abort").json.data.aborted).toBe("rebase");
    expect(me.read("readme.md")).toBe("mine\n");
  });
});

describe("rescue", () => {
  test("finds a dropped stash and brings it back", () => {
    const s = new Sandbox().init();
    s.write("lost.txt", "precious\n");
    s.git("stash", "push", "-u", "-m", "precious work");
    const sha = s.git("rev-parse", "stash@{0}");
    s.git("stash", "drop");
    const items = s.run("rescue").json.data.items;
    expect(items.some((i: any) => i.commit === sha)).toBe(true);
    s.run("rescue", sha.slice(0, 7));
    expect(s.read("lost.txt")).toBe("precious\n");
  });
});
