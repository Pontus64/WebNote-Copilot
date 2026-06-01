import { readFileSync, writeFileSync } from "node:fs";

const [file] = process.argv.slice(2);

if (!file) {
	console.error("Usage: node scripts/strip-trailing-whitespace.mjs <file>");
	process.exit(1);
}

const source = readFileSync(file, "utf8");
const normalized = source.replace(/[ \t]+(\r?\n|$)/g, "$1");

if (normalized !== source) {
	writeFileSync(file, normalized);
}
