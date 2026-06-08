// 把构建好的 widget 大包拷进 extension/,并将版本号同步进 extension/manifest.json。
// 需先执行 build:widget(产出 public/embed/floating-notes-widget.js)。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// 拷贝 widget 大包,并做“扩展安全化”处理。
//
// Chrome 内容脚本用的是 Chromium 的 IsStringUTF8 校验,比标准 UTF-8 更严格:它会拒绝
// 非字符码点(如 U+FFFF,被 ProseMirror/Milkdown 当哨兵值)和控制字符,报“不是 UTF-8 编码”。
// 这些字符在标准 UTF-8 里合法,所以源文件(网页 <script> / 油猴 @require 用)无需处理;
// 但作为内容脚本必须把它们转义成等价的 \uXXXX,使文件变成纯 ASCII 又不改变运行时语义。
function sanitizeForContentScript(code) {
	let out = "";
	let count = 0;
	for (let i = 0; i < code.length; i++) {
		const u = code.charCodeAt(i);
		const isNoncharacter =
			(u & 0xfffe) === 0xfffe || (u >= 0xfdd0 && u <= 0xfdef);
		const isControl =
			(u < 0x20 && u !== 0x09 && u !== 0x0a && u !== 0x0d) ||
			(u >= 0x7f && u <= 0x9f);
		const isBom = u === 0xfeff;
		if (isNoncharacter || isControl || isBom) {
			out += "\\u" + u.toString(16).padStart(4, "0");
			count++;
		} else {
			out += code[i];
		}
	}
	return { out, count };
}

const rawWidget = readFileSync(widgetSrc, "utf8");
const { out: safeWidget, count: escaped } = sanitizeForContentScript(rawWidget);
writeFileSync(widgetDest, safeWidget);

// 同步 manifest 版本号。
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== version) {
	manifest.version = version;
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

console.log(
	`Extension built: widget sanitized (${escaped} chars escaped), manifest version = ${version}`
);
