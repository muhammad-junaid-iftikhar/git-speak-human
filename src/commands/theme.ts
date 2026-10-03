import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeDir, readJSON, writeJSON } from "../config";
import { ctx } from "../context";
import { fail } from "../errors";
import { define } from "../registry";
import { c, ui } from "../ui";
import {
  TOOL_CHECK,
  applyPalette,
  applyShell,
  applyTerminal,
  canStyleTerminal,
  captureShell,
  captureTerminal,
  currentStarship,
  ensureRcBlock,
  fontInstalled,
  missingTools,
  removeRcBlock,
} from "../looks/apply";
import { INDEX_URL, THEME_URL, allLooks, findLook, swatch, userDir, validateLook, type Look } from "../looks/model";

const dailyFile = () => join(homeDir(), "theme-daily.json");

function currentLook(): string | null {
  return readJSON<{ current?: string }>(join(homeDir(), "look.json"), {}).current ?? null;
}

function rememberLook(name: string): void {
  writeJSON(join(homeDir(), "look.json"), { current: name, applied: new Date().toISOString() });
}

export function captureLook(name: string, title?: string): Look {
  const { terminal } = canStyleTerminal() ? captureTerminal() : { terminal: { baseProfile: "Basic" } as Look["terminal"] };
  const { tools, ...shell } = captureShell();
  const starship = currentStarship();
  return {
    name,
    title: title ?? name.replace(/(^|-)(\w)/g, (_, d, ch) => `${d ? " " : ""}${ch.toUpperCase()}`),
    author: process.env.USER ?? "me",
    description: "Saved from my own terminal setup",
    terminal,
    prompt: starship ? { starship } : null,
    shell,
    tools,
  };
}

async function onlineLooks(): Promise<Look[]> {
  const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) fail("Couldn't reach GitHub to list online themes.", { code: "offline" });
  const index = (await res!.json()) as { themes: { name: string; title: string; description: string; author: string }[] };
  return index.themes.map((t) => ({ ...t, terminal: {}, source: "online" }) as unknown as Look);
}

async function downloadLook(name: string): Promise<Look | null> {
  const res = await fetch(THEME_URL(name), { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) return null;
  const look = (await res.json()) as Look;
  if (validateLook(look).length) return null;
  writeFileSync(join(userDir(), `${look.name}.json`), JSON.stringify(look, null, 2) + "\n");
  return { ...look, source: "yours" };
}

function preview(look: Look): void {
  ui.line(`   ${swatch(look, ctx.useColor)}  ${c.bold(look.title)} ${c.dim(`(${look.name}) by ${look.author}`)}`);
  ui.line(c.dim(`   ${look.description}`));
  const t = look.terminal;
  const bits = [
    t.font ? `font ${t.font.name} ${t.font.size}pt` : "",
    t.opacity && t.opacity < 1 ? `${Math.round(t.opacity * 100)}% opaque` : "",
    look.prompt ? "Starship prompt" : "",
    look.shell?.autosuggestColor ? "suggestion color" : "",
    look.shell?.syntax ? "syntax colors" : "",
    look.tools?.length ? `tools: ${look.tools.join(", ")}` : "",
  ].filter(Boolean);
  if (bits.length) ui.line(c.dim(`   ${bits.join(" · ")}`));
}

export async function applyLook(look: Look, opts: { skipTerminal?: boolean; skipShell?: boolean; quiet?: boolean } = {}): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { theme: look.name };
  if (!currentLook() && !findLook("my-original") && !ctx.flags.dryRun) {
    writeFileSync(join(userDir(), "my-original.json"), JSON.stringify(captureLook("my-original", "My Original"), null, 2) + "\n");
    result.savedOriginal = true;
    if (!opts.quiet) ui.hint("Saved your current setup as \"my-original\" first, so you can always go back: gitbuddy theme my-original");
  }
  if (ctx.flags.dryRun) return { ...result, dryRun: true };
  if (look.terminal.font && canStyleTerminal() && !fontInstalled(look.terminal.font.name)) {
    const cask = look.terminal.font.brew;
    if (cask && Bun.which("brew") && ui.confirm(`This theme uses the font ${look.terminal.font.name}. Install it with brew (${cask})?`, { default: true })) {
      if (!opts.quiet) ui.line(c.dim(`   brew install --cask ${cask}…`));
      Bun.spawnSync(["brew", "install", "--cask", cask], { stdout: "ignore", stderr: "ignore" });
    }
  }
  if (!opts.skipTerminal) result.terminal = await applyTerminal(look);
  if (!opts.skipShell) {
    const rc = ensureRcBlock();
    const shell = applyShell(look);
    result.shell = { ...shell, rcChanged: rc.changed, backup: rc.backup };
    if (rc.changed && !opts.quiet) ui.hint(`Added one line to ~/.zshrc so themes can set your prompt and colors (backup: ${rc.backup ?? "none needed"}).`);
  }
  applyPalette(look);
  rememberLook(look.name);
  const missing = missingTools(look);
  result.missingTools = missing;
  if (missing.length && ctx.interactive && Bun.which("brew") && ui.confirm(`Install missing tools for this theme (${missing.join(", ")}) with brew?`, { default: true })) {
    Bun.spawnSync(["brew", "install", ...missing.map((m) => TOOL_CHECK[m].brew)], { stdout: "inherit", stderr: "inherit" });
    result.missingTools = missingTools(look);
  }
  return result;
}

define({
  name: "theme",
  aliases: ["themes", "look", "looks"],
  group: "you",
  summary: "Restyle your whole terminal in one go: colors, font, prompt, suggestions",
  args: [
    { name: "name", description: "Theme to apply, or: list, save, random, daily, preview, current, online" },
    { name: "value", description: "Extra value (e.g. a name for save, on/off for daily)", variadic: true },
  ],
  options: {
    online: { type: "boolean", description: "Include themes shared on GitHub" },
    "skip-terminal": { type: "boolean", description: "Don't change Terminal.app colors/font" },
    "skip-shell": { type: "boolean", description: "Don't change the prompt or zsh settings" },
    uninstall: { type: "boolean", description: "Remove gitbuddy's line from ~/.zshrc" },
  },
  needsRepo: false,
  mutates: true,
  examples: ["gitbuddy theme", "gitbuddy theme dracula", "gitbuddy theme random", "gitbuddy theme save my-setup", "gitbuddy theme daily on", "gitbuddy theme my-original"],
  async run({ args, opts }) {
    const [first, ...rest] = args;
    const sub = first?.toLowerCase();

    if (opts.uninstall) {
      const removed = removeRcBlock();
      ui.ok(removed ? "Removed gitbuddy's theme line from ~/.zshrc. Open a new tab to see your old prompt." : "Nothing to remove.");
      ctx.data = { removed };
      return;
    }

    if (sub === "save") {
      const name = (rest[0] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
      if (!name) fail("Give your theme a name: gitbuddy theme save my-setup");
      const look = captureLook(name);
      const errors = validateLook(look);
      if (errors.length) fail(`I couldn't capture a valid theme: ${errors[0]}`);
      const file = join(userDir(), `${name}.json`);
      if (!ctx.flags.dryRun) writeFileSync(file, JSON.stringify(look, null, 2) + "\n");
      ui.say("star", c.ok(`Saved your current look as "${name}"`));
      ui.line(`   ${c.accent(file)}`);
      ui.hint("Share it with everyone: copy it into themes/ in the gitbuddy repo and open a pull request.");
      ctx.data = { saved: name, file, look };
      return;
    }

    if (sub === "daily") {
      const on = !["off", "false", "no", "0"].includes((rest[0] ?? "on").toLowerCase());
      writeJSON(dailyFile(), { enabled: on, last: on ? readJSON<{ last?: string }>(dailyFile(), {}).last : undefined });
      ui.ok(on ? "A fresh theme every day! It changes the first time you use gitbuddy each day." : "Daily themes are off.");
      ctx.data = { daily: on };
      return;
    }

    if (sub === "current") {
      const name = currentLook();
      ctx.data = { current: name };
      ui.line(name ? `Current theme: ${c.bold(name)}` : "No gitbuddy theme applied yet.");
      return;
    }

    let looks = allLooks();
    if (opts.online || sub === "online") {
      const online = await ui.spin("Fetching themes from GitHub…", onlineLooks);
      const have = new Set(looks.map((l) => l.name));
      looks = [...looks, ...online.filter((l) => !have.has(l.name))];
    }

    if (sub === "preview") {
      const look = findLook(rest[0] ?? "") ?? fail(`No theme called "${rest[0]}".`, { hint: "See them: gitbuddy theme" });
      preview(look);
      ctx.data = { look };
      return;
    }

    if (!sub || sub === "list" || sub === "online") {
      const current = currentLook();
      ctx.data = { current, themes: looks.map(({ name, title, author, description, source }) => ({ name, title, author, description, source })) };
      if (!ctx.interactive || sub === "list") {
        ui.say("star", c.bold(`${looks.length} themes`) + c.dim(current ? ` · now using ${current}` : ""));
        ui.blank();
        for (const l of looks) ui.line(`   ${l.name === current ? c.accent("▶") : " "} ${swatch(l, ctx.useColor).padEnd(0)}  ${c.bold(l.name.padEnd(18))} ${c.dim(l.description.slice(0, 60))}${l.source === "online" ? c.dim(" (online)") : ""}`);
        ui.blank();
        ui.next("gitbuddy theme <name>", "try one");
        ui.next("gitbuddy theme random", "surprise me");
        return;
      }
      const pick = ui.pick(
        "Pick a look:",
        looks.map((l) => ({ label: `${swatch(l, ctx.useColor)}  ${l.name === current ? c.accent("▶ ") : ""}${c.bold(l.name)} ${c.dim(l.description.slice(0, 50))}`, value: l.name })),
      );
      return applyNamed(pick, looks, opts);
    }

    if (sub === "random") {
      const current = currentLook();
      const pool = looks.filter((l) => l.name !== current && l.name !== "my-original" && l.source !== "online");
      if (!pool.length) fail("No other themes to pick from.");
      const look = pool[Math.floor(Math.random() * pool.length)];
      return applyNamed(look.name, looks, opts);
    }

    return applyNamed(sub, looks, opts);
  },
});

async function applyNamed(name: string, looks: Look[], opts: Record<string, unknown>): Promise<void> {
  let look = looks.find((l) => l.name === name);
  if (look?.source === "online" || (!look && opts.online)) look = (await ui.spin(`Downloading ${name}…`, () => downloadLook(name))) ?? undefined;
  if (!look) {
    const close = looks.filter((l) => l.name.includes(name) || name.includes(l.name)).map((l) => l.name);
    fail(`No theme called "${name}".`, { code: "no_such_theme", hint: close.length ? `Did you mean: ${close.join(", ")}?` : "See them: gitbuddy theme list (or --online)" });
  }
  ui.say("star", `Applying ${c.bold(look!.title)}…`);
  const result = await applyLook(look!, { skipTerminal: Boolean(opts["skip-terminal"]), skipShell: Boolean(opts["skip-shell"]) });
  const term = result.terminal as { applied: boolean; note?: string; fontFound?: boolean } | undefined;
  ui.blank();
  preview(look!);
  ui.blank();
  if (term?.applied) ui.ok(term.note ? "Terminal profile installed and set as default." : "Terminal colors and font updated (open windows too).");
  if (term?.note) ui.hint(term.note);
  if (term?.applied && term.fontFound === false) ui.warn(`The font ${look!.terminal.font?.name} isn't installed, so I used a fallback.`);
  if (result.shell) ui.ok("Prompt and shell colors ready. Open a new tab (or run: exec zsh) to see them.");
  const missing = (result.missingTools as string[]) ?? [];
  if (missing.length) ui.hint(`For the full look, install: brew install ${missing.map((m) => TOOL_CHECK[m]?.brew ?? m).join(" ")}`);
  ui.hint("Changed your mind? gitbuddy theme my-original");
  ctx.data = { ...result, look: look!.name };
}

export async function maybeDailyTheme(): Promise<void> {
  if (!ctx.interactive || ctx.flags.dryRun) return;
  const daily = readJSON<{ enabled?: boolean; last?: string }>(dailyFile(), {});
  if (!daily.enabled) return;
  const today = new Date().toISOString().slice(0, 10);
  if (daily.last === today) return;
  writeJSON(dailyFile(), { ...daily, last: today });
  const current = currentLook();
  const pool = allLooks().filter((l) => l.name !== current && l.name !== "my-original");
  if (!pool.length) return;
  const look = pool[Math.floor(Math.random() * pool.length)];
  await applyLook(look, { quiet: true });
  ui.line(c.dim(`   🎨 Today's theme: ${look.title}. Open a new tab for the full look. (gitbuddy theme daily off to stop)`));
}

