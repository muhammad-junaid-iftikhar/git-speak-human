import { describe, expect, test } from "bun:test";
import { Sandbox } from "./helpers";

describe("workspaces", () => {
  test("work carries existing changes into the first workspace", () => {
    const s = new Sandbox().init();
    s.write("readme.md", "dark\n");
    const r = s.run("work", "dark mode");
    expect(r.json.data.carriedChanges).toBe(true);
    expect(s.read("readme.md")).toBe("dark\n");
  });

  test("switching keeps each workspace's changes under the right name", () => {
    const s = new Sandbox().init();
    s.run("work", "dark mode");
    s.write("readme.md", "dark\n");
    s.write("theme.css", "body{}\n");
    s.run("work", "fix button");
    expect(s.read("readme.md")).toBe("hello\n");
    expect(s.exists("theme.css")).toBe(false);
    s.write("button.ts", "btn\n");

    const list = s.run("list").json.data.workspaces;
    const dark = list.find((w: any) => w.name === "dark mode");
    expect(dark.changedFiles).toBe(2);

    s.run("switch", "dark mode");
    expect(s.read("readme.md")).toBe("dark\n");
    expect(s.exists("theme.css")).toBe(true);
    expect(s.exists("button.ts")).toBe(false);
    expect(s.git("status", "--porcelain")).toContain("?? theme.css");

    s.run("switch", "fix button");
    expect(s.exists("button.ts")).toBe(true);
    expect(s.read("readme.md")).toBe("hello\n");
  });

  test("save keeps files where they are", () => {
    const s = new Sandbox().init();
    s.run("work", "notes");
    s.write("notes.md", "draft\n");
    const r = s.run("save");
    expect(r.code).toBe(0);
    expect(s.read("notes.md")).toBe("draft\n");
    expect(r.json.data.workspace).toBe("notes");
  });

  test("save is not an alias of done", () => {
    const s = new Sandbox().init();
    s.write("x.txt", "x\n");
    s.run("save");
    expect(s.git("log", "--oneline").split("\n").length).toBe(1);
  });

  test("switch with unknown name suggests close ones", () => {
    const s = new Sandbox().init();
    s.run("work", "dark mode");
    const r = s.run("switch", "dark");
    expect(r.json.error.code).toBe("no_such_workspace");
    expect(r.json.error.hint).toContain("dark mode");
  });

  test("switch after main moved applies changes on top", () => {
    const s = new Sandbox().init();
    s.run("work", "a");
    s.write("a.txt", "a\n");
    s.run("work", "b");
    s.write("b.txt", "b\n");
    s.run("done", "b done");
    s.run("switch", "a");
    expect(s.exists("a.txt")).toBe(true);
    expect(s.exists("b.txt")).toBe(true);
  });

  test("drop goes to trash and restore brings it back", () => {
    const s = new Sandbox().init();
    s.run("work", "idea");
    s.write("idea.txt", "!\n");
    s.run("work", "other");
    expect(s.run("drop", "idea", "--yes").code).toBe(0);
    expect(s.run("list").json.data.workspaces.map((w: any) => w.name)).not.toContain("idea");
    expect(s.run("trash").json.data.items[0].name).toBe("idea");
    s.run("restore", "idea");
    s.run("switch", "idea");
    expect(s.read("idea.txt")).toBe("!\n");
  });

  test("rename keeps the work", () => {
    const s = new Sandbox().init();
    s.run("work", "old");
    s.write("o.txt", "o\n");
    s.run("rename", "old", "new name");
    s.run("work", "x");
    s.run("switch", "new name");
    expect(s.exists("o.txt")).toBe(true);
  });
});
