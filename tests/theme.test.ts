import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateLook } from "../src/looks/model";
import { Sandbox } from "./helpers";

const THEMES = join(import.meta.dir, "..", "themes");

function sandbox() {
  const s = new Sandbox();
  s.env.HOME = s.root;
  s.env.GITBUDDY_NO_TERMINAL = "1";
  writeFileSync(join(s.root, ".zshrc"), "eval \"$(starship init zsh)\"\nalias ll='eza -la'\n");
  return s;
}

describe("theme files", () => {
  test("every theme in themes/ is valid and listed in index.json", () => {
    const files = readdirSync(THEMES).filter((f) => f.endsWith(".json") && f !== "index.json");
    expect(files.length).toBeGreaterThanOrEqual(10);
    const index = JSON.parse(readFileSync(join(THEMES, "index.json"), "utf-8")).themes.map((t: any) => t.name).sort();
    for (const f of files) {
      const look = JSON.parse(readFileSync(join(THEMES, f), "utf-8"));
      expect({ file: f, errors: validateLook(look) }).toEqual({ file: f, errors: [] });
      expect(look.name).toBe(f.replace(/\.json$/, ""));
    }
    expect(index).toEqual(files.map((f) => f.replace(/\.json$/, "")).sort());
  });

  test("validation catches mistakes", () => {
    expect(validateLook({ name: "Bad Name" })).not.toEqual([]);
    expect(validateLook({ name: "list", title: "x", author: "y", description: "z", terminal: { baseProfile: "Basic" } })).toContain('name: "list" is reserved');
  });
});

describe("gitbuddy theme", () => {
  test("lists themes", () => {
    const s = sandbox();
    const names = s.run("theme", "list").json.data.themes.map((t: any) => t.name);
    expect(names).toContain("dracula");
    expect(names).toContain("juni");
  });

  test("applying sets prompt, shell colors and palette, and saves the original first", () => {
    const s = sandbox();
    const r = s.run("theme", "dracula", "--yes");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.savedOriginal).toBe(true);
    expect(existsSync(join(s.home, "themes", "my-original.json"))).toBe(true);
    const rc = readFileSync(join(s.root, ".zshrc"), "utf-8");
    expect(rc.match(/>>> gitbuddy theme >>>/g)?.length).toBe(1);
    const zsh = readFileSync(join(s.home, "shell", "theme.zsh"), "utf-8");
    expect(zsh).toContain("STARSHIP_CONFIG=");
    expect(zsh).toContain("ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=#6272a4'");
    expect(readFileSync(join(s.home, "shell", "starship.toml"), "utf-8")).toContain("#d6acff");
    expect(JSON.parse(readFileSync(join(s.home, "palette.json"), "utf-8")).accent).toBe("#d6acff");
    expect(s.run("theme", "current").json.data.current).toBe("dracula");

    s.run("theme", "nord", "--yes");
    expect(readFileSync(join(s.root, ".zshrc"), "utf-8").match(/>>> gitbuddy theme >>>/g)?.length).toBe(1);
    expect(s.run("theme", "current").json.data.current).toBe("nord");
  });

  test("juni keeps its own starship prompt", () => {
    const s = sandbox();
    s.run("theme", "juni", "--yes");
    expect(readFileSync(join(s.home, "shell", "starship.toml"), "utf-8")).toContain("on 🔥");
  });

  test("save captures the current setup, uninstall removes the zshrc line", () => {
    const s = sandbox();
    const r = s.run("theme", "save", "my-look");
    expect(r.json.ok).toBe(true);
    expect(validateLook(r.json.data.look)).toEqual([]);
    expect(r.json.data.look.shell.aliases.ll).toBe("eza -la");
    s.run("theme", "dracula", "--yes");
    s.run("theme", "--uninstall");
    expect(readFileSync(join(s.root, ".zshrc"), "utf-8")).not.toContain("gitbuddy theme");
  });

  test("random picks a different theme, daily can be switched on and off", () => {
    const s = sandbox();
    s.run("theme", "dracula", "--yes");
    const r = s.run("theme", "random", "--yes");
    expect(r.json.data.look).not.toBe("dracula");
    expect(s.run("theme", "daily", "on").json.data.daily).toBe(true);
    expect(s.run("theme", "daily", "off").json.data.daily).toBe(false);
  });

  test("unknown theme suggests close names", () => {
    const s = sandbox();
    expect(s.run("theme", "drac").json.error.hint).toContain("dracula");
  });
});
