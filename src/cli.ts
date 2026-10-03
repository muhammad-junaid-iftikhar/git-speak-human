#!/usr/bin/env bun
import "./commands";
import { execute, splitGlobals } from "./main";

const argv = process.argv.slice(2);
const wantsJson = Boolean(splitGlobals(argv).flags.json);
const result = await execute(argv);
if (wantsJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exitCode = result.exit_code;
