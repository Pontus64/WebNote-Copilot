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
    // 跳过 . 开头(.DS_Store 等)和 _ 开头(Chrome 加载时生成的 _metadata,且 _ 前缀
    // 是扩展保留命名,商店会拒绝)。README 等文档也不进包。
    if (name.startsWith(".") || name.startsWith("_") || name.endsWith(".md")) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, files);
    } else {
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

// 1) 带版本号的归档,放 dist/(以后上架商店 / 留存用)。
mkdirSync(distDir, { recursive: true });
const distOut = join(distDir, `floating-notes-extension-${version}.zip`);
writeFileSync(distOut, zipped);

// 2) 稳定文件名,放 public/,经 Cloudflare 静态资源在 /floating-notes-extension.zip 提供下载。
//    URL 不随版本变化,/extension 安装页固定指向它。
const publicOut = join(root, "public/floating-notes-extension.zip");
writeFileSync(publicOut, zipped);

const kb = (zipped.length / 1024).toFixed(0);
console.log(
  `Packed ${Object.keys(files).length} files (${kb} KB)\n  → ${distOut}\n  → ${publicOut}`
);
