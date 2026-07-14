import fs from "node:fs";
import path from "node:path";

const root = path.resolve("research/immersive-translate/1.30.3_0");
const [relativeFile, ...terms] = process.argv.slice(2);

if (!relativeFile || terms.length === 0) {
  console.error("Usage: node tools/extract-immersive-snippets.mjs <file> <term...>");
  process.exit(1);
}

const file = path.resolve(root, relativeFile);
if (!file.startsWith(root + path.sep)) {
  console.error("File must be under research/immersive-translate/1.30.3_0");
  process.exit(1);
}

const source = fs.readFileSync(file, "utf8");
const radius = Number(process.env.SNIPPET_RADIUS || 900);
const maxHits = Number(process.env.SNIPPET_HITS || 5);

for (const term of terms) {
  let from = 0;
  let hits = 0;
  console.log(`\n### ${term}`);

  while (hits < maxHits) {
    const index = source.indexOf(term, from);
    if (index < 0) break;

    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + term.length + radius);
    const snippet = source
      .slice(start, end)
      .replace(/\s+/g, " ")
      .trim();

    console.log(`\n-- hit ${hits + 1} @ ${index}`);
    console.log(snippet);
    from = index + term.length;
    hits += 1;
  }

  if (hits === 0) {
    console.log("No hits.");
  }
}
