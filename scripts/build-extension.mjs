// 把构建好的 widget 大包拷进 extension/,并将版本号同步进 extension/manifest.json。
// 需先执行 build:widget(产出 public/embed/floating-notes-widget.js)。

import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const widgetSrc = join(root, "public/embed/floating-notes-widget.js");
const widgetDest = join(root, "extension/floating-notes-widget.js");
const manifestPath = join(root, "extension/manifest.json");
const entryPath = join(root, "client/widget/entry.tsx");

if (!existsSync(widgetSrc)) {
	console.error(
		`Widget bundle not found: ${widgetSrc}\nRun \`npm run build:widget\` first.`
	);
	process.exit(1);
}

// 从 widget 入口读取 WIDGET_VERSION 作为唯一真源。
const entry = readFileSync(entryPath, "utf8");
const versionMatch = entry.match(/WIDGET_VERSION\s*=\s*["']([^"']+)["']/);
if (!versionMatch) {
	console.error(`Could not read WIDGET_VERSION from ${entryPath}`);
	process.exit(1);
}
const version = versionMatch[1];

// 拷贝 widget 大包。
copyFileSync(widgetSrc, widgetDest);

// 同步 manifest 版本号。
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== version) {
	manifest.version = version;
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

console.log(`Extension built: widget copied, manifest version = ${version}`);
