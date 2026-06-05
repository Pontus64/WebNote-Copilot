// 把 extension/ 目录打包成可上传 Chrome 商店 / 分发的 zip。
// 复用项目已有的 fflate 依赖,无需额外安装。
// 前置:先跑 build:widget + build:extension + build:icons(或 npm run build),确保产物齐全。

import { zipSync } from "fflate";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension");
const distDir = join(root, "dist");

const widget = join(extDir, "floating-notes-widget.js");
if (!existsSync(widget)) {
  console.error(
    "缺少 extension/floating-notes-widget.js。请先运行 `npm run build:extension`。"
  );
  process.exit(1);
}

// 递归收集 extension/ 下所有文件,key 用相对路径(zip 内路径)。
function collect(dir, files) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, files);
    } else if (!name.endsWith(".md")) {
      // README 等文档不进上架包。
      const rel = relative(extDir, full).split("\\").join("/");
      files[rel] = new Uint8Array(readFileSync(full));
    }
  }
  return files;
}

const files = collect(extDir, {});

const manifest = JSON.parse(
  Buffer.from(files["manifest.json"]).toString("utf8")
);
const version = manifest.version || "0.0.0";

const zipped = zipSync(files, { level: 9 });

mkdirSync(distDir, { recursive: true });
const outPath = join(distDir, `floating-notes-extension-${version}.zip`);
writeFileSync(outPath, zipped);

const kb = (zipped.length / 1024).toFixed(0);
console.log(`Packed ${Object.keys(files).length} files → ${outPath} (${kb} KB)`);
