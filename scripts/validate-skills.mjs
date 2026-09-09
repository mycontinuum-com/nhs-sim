import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".agents/skills");
const skills = [];
for (const entry of readdirSync(root)) {
  const directory = resolve(root, entry);
  if (!statSync(directory).isDirectory()) continue;
  const path = resolve(directory, "SKILL.md");
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${entry}: missing SKILL.md`);
  }
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) throw new Error(`${entry}: missing YAML frontmatter`);
  const name = frontmatter[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)/m)?.[1]?.trim();
  if (!name || !description) throw new Error(`${entry}: name and description are required`);
  skills.push(name);
}

const duplicates = skills.filter((name, index) => skills.indexOf(name) !== index);
if (duplicates.length) throw new Error(`Duplicate skill names: ${[...new Set(duplicates)].join(", ")}`);
console.log(JSON.stringify({ ok: true, skillRoot: ".agents/skills", skills: skills.length }));
