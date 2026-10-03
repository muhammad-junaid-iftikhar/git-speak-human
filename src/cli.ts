#!/usr/bin/env bun

import { execSync } from "child_process";
import { parseArgs } from "util";

const VERSION = "0.0.1";

interface Command {
  name: string;
  aliases: string[];
  description: string;
  run: (args: string[]) => void;
}

const run = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
};

const commands: Command[] = [
  {
    name: "save",
    aliases: ["s", "commit"],
    description: "Save your changes with a message",
    run: (args) => {
      const message = args.join(" ") || "Update";
      console.log(`💾 Saving: "${message}"`);
      run("git add .");
      run(`git commit -m "${message}"`);
      console.log("✅ Changes saved!");
    },
  },
  {
    name: "push",
    aliases: ["p", "send"],
    description: "Send your changes to the team",
    run: () => {
      console.log("📤 Pushing changes...");
      const branch = run("git rev-parse --abbrev-ref HEAD");
      run(`git push origin ${branch}`);
      console.log("✅ Changes sent!");
    },
  },
  {
    name: "pull",
    aliases: ["get", "update"],
    description: "Get the latest changes from the team",
    run: () => {
      console.log("📥 Pulling latest changes...");
      run("git pull origin");
      console.log("✅ You're up to date!");
    },
  },
  {
    name: "status",
    aliases: ["st", "check"],
    description: "See what you've changed",
    run: () => {
      const status = run("git status --short");
      if (!status) {
        console.log("✨ Everything is clean!");
        return;
      }
      console.log("\n📝 Your changes:");
      console.log(status);
      console.log();
    },
  },
  {
    name: "start",
    aliases: ["branch", "new"],
    description: "Start a new piece of work",
    run: (args) => {
      const name = args.join("-") || "feature";
      console.log(`🌱 Creating new branch: ${name}`);
      run(`git checkout -b ${name}`);
      console.log(`✅ You're now on branch: ${name}`);
    },
  },
  {
    name: "switch",
    aliases: ["go", "checkout"],
    description: "Switch to another branch",
    run: (args) => {
      const branch = args.join("-");
      if (!branch) {
        console.log("📋 Available branches:");
        console.log(run("git branch -a"));
        return;
      }
      console.log(`🔄 Switching to ${branch}...`);
      run(`git checkout ${branch}`);
      console.log(`✅ You're now on: ${branch}`);
    },
  },
  {
    name: "undo",
    aliases: ["revert"],
    description: "Undo your last changes",
    run: () => {
      console.log("⏮️  Undoing last commit...");
      run("git reset --soft HEAD~1");
      console.log("✅ Last commit undone (changes still here)");
    },
  },
  {
    name: "history",
    aliases: ["log", "timeline"],
    description: "See what changed recently",
    run: () => {
      const log = run("git log --oneline -10");
      console.log("\n📜 Recent changes:");
      console.log(log);
      console.log();
    },
  },
  {
    name: "help",
    aliases: ["h", "-h", "--help"],
    description: "Show this help message",
    run: () => {
      console.log(`
🎤 git-speak-human v${VERSION}
Git for people who don't know git.

Usage: speak <command> [args]

Commands:
`);
      commands.forEach((cmd) => {
        const aliases = cmd.aliases.length
          ? ` (${cmd.aliases.join(", ")})`
          : "";
        console.log(`  ${cmd.name.padEnd(10)} ${aliases.padEnd(20)} ${cmd.description}`);
      });
      console.log(`
Examples:
  speak save "I added a feature"
  speak push
  speak pull
  speak start my-feature
  speak switch main
  speak status
  speak undo
  speak history
`);
    },
  },
];

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const helpCmd = commands.find((c) => c.name === "help");
    helpCmd?.run([]);
    return;
  }

  const commandName = args[0].toLowerCase();
  const commandArgs = args.slice(1);

  const command = commands.find(
    (cmd) => cmd.name === commandName || cmd.aliases.includes(commandName)
  );

  if (!command) {
    console.log(`❌ Unknown command: ${commandName}`);
    console.log(`Run 'speak help' to see available commands.`);
    process.exit(1);
  }

  try {
    command.run(commandArgs);
  } catch (error) {
    console.error(`❌ Something went wrong: ${error}`);
    process.exit(1);
  }
}

main();
