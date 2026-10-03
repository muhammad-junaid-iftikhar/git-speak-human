import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateLook } from "../src/looks/model";

const dir = join(import.meta.dir, "..", "themes");
const themes = [];
let bad = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort()) {
  const look = JSON.parse(readFileSync(join(dir, f), "utf-8"));
  const errors = validateLook(look);
  if (look.name !== f.replace(/\.json$/, "")) errors.push(`file name must be ${look.name}.json`);
  if (errors.length) {
    bad++;
    console.error(`✖ ${f}: ${errors.join("; ")}`);
    continue;
  }
  themes.push({ name: look.name, title: look.title, author: look.author, description: look.description });
}
writeFileSync(join(dir, "index.json"), JSON.stringify({ themes }, null, 2) + "\n");
console.log(`✔ ${themes.length} themes indexed${bad ? `, ${bad} invalid` : ""}`);
if (bad) process.exit(1);
