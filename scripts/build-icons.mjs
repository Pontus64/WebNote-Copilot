// 生成扩展图标 PNG(16/48/128),零额外依赖:纯 Node 画图 + zlib 编码 PNG。
// 图形:蓝色圆角徽章 + 白色便签卡片 + 三条蓝色文字线。4x 超采样做抗锯齿。

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "extension/icons");
mkdirSync(outDir, { recursive: true });

const BADGE = [37, 99, 235]; // #2563eb
const CARD = [255, 255, 255];
const LINE = [59, 130, 246]; // #3b82f6

// 圆角矩形有向距离场(Inigo Quilez):<0 表示在内部。
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

// 归一化坐标 [0,1] 下,返回某点的 RGBA。
function shade(nx, ny) {
  // 外层蓝色徽章(留 4% 边距)。
  if (sdRoundBox(nx, ny, 0.5, 0.5, 0.46, 0.46, 0.2) > 0) {
    return [0, 0, 0, 0];
  }

  let color = BADGE;

  // 白色便签卡片。
  const inCard = sdRoundBox(nx, ny, 0.5, 0.515, 0.26, 0.3, 0.07) < 0;
  if (inCard) {
    color = CARD;
    // 三条文字线。
    const lines = [
      { y: 0.4, x0: 0.32, x1: 0.6 },
      { y: 0.515, x0: 0.32, x1: 0.66 },
      { y: 0.63, x0: 0.32, x1: 0.52 },
    ];
    for (const ln of lines) {
      if (Math.abs(ny - ln.y) < 0.028 && nx >= ln.x0 && nx <= ln.x1) {
        color = LINE;
        break;
      }
    }
  }

  return [color[0], color[1], color[2], 255];
}

function renderRGBA(size) {
  const SS = 4; // 超采样倍数
  const buf = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          const [pr, pg, pb, pa] = shade(nx, ny);
          const af = pa / 255;
          r += pr * af;
          g += pg * af;
          b += pb * af;
          a += pa;
        }
      }
      const n = SS * SS;
      const ai = a / n;
      const i = (y * size + x) * 4;
      // 预乘还原:颜色按覆盖到的不透明采样平均。
      const cover = ai > 0 ? n / (a / 255) : 0;
      buf[i] = Math.round((r / n) * cover);
      buf[i + 1] = Math.round((g / n) * cover);
      buf[i + 2] = Math.round((b / n) * cover);
      buf[i + 3] = Math.round(ai);
    }
  }
  return buf;
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置一个 filter 字节(0 = None)。
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const png = encodePng(size, renderRGBA(size));
  writeFileSync(join(outDir, `icon-${size}.png`), png);
}

console.log("Icons written: extension/icons/icon-{16,48,128}.png");
