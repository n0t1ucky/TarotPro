const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 紫底塔羅牌樣式圖標：圓角牌面 + 八角星 + 金色月牙
function drawTarot(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;

  // 圓角牌面（紫色底）
  const half = size * 0.46;
  const corner = size * 0.16;
  const ax = Math.max(Math.abs(dx) - (half - corner), 0);
  const ay = Math.max(Math.abs(dy) - (half - corner), 0);
  if (ax * ax + ay * ay > corner * corner) return [0, 0, 0, 0];
  if (Math.abs(dx) > half || Math.abs(dy) > half) return [0, 0, 0, 0];

  // 內圈白底（牌面中央）
  const innerHalf = size * 0.34;
  const iCorner = size * 0.10;
  const iax = Math.max(Math.abs(dx) - (innerHalf - iCorner), 0);
  const iay = Math.max(Math.abs(dy) - (innerHalf - iCorner), 0);
  const inCard = iax * iax + iay * iay <= iCorner * iCorner &&
                 Math.abs(dx) <= innerHalf && Math.abs(dy) <= innerHalf;
  if (inCard) return [248, 244, 255, 255];

  // 八角星（紫，置中於白底上）
  const s1 = size * 0.16;
  const s2 = size * 0.105;
  if (Math.abs(dx) + Math.abs(dy) <= s1 ||
      (Math.abs(dx) <= s2 && Math.abs(dy) <= s2)) {
    return [150, 120, 220, 255];
  }

  // 金色月牙（右上角）
  const mc1x = cx + size * 0.16;
  const mc1y = cy - size * 0.16;
  const mc2x = cx + size * 0.22;
  const mc2y = cy - size * 0.22;
  const d1 = Math.sqrt((x - mc1x) * (x - mc1x) + (y - mc1y) * (y - mc1y));
  const d2 = Math.sqrt((x - mc2x) * (x - mc2x) + (y - mc2y) * (y - mc2y));
  if (d1 <= size * 0.14 && d2 > size * 0.11) return [250, 200, 90, 255];

  return [150, 120, 220, 255];
}

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

const pngs = {};
for (const size of [16, 32, 48, 256]) {
  const png = makePng(size, drawTarot);
  pngs[size] = png;
  const file = path.join(assetsDir, `tray-${size}.png`);
  fs.writeFileSync(file, png);
  console.log('written', file);
}

// 組合成 .ico（Vista+ 支援 PNG 內嵌，即使 256×256 也無失真）
function makeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4); // count
  const dirSize = 16 * entries.length;
  const dir = Buffer.alloc(dirSize);
  let offset = 6 + dirSize;
  entries.forEach(({ size, data }, i) => {
    const p = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, p);      // width
    dir.writeUInt8(size >= 256 ? 0 : size, p + 1);  // height
    dir.writeUInt8(0, p + 2);                        // color count
    dir.writeUInt8(0, p + 3);                        // reserved
    dir.writeUInt16LE(1, p + 4);                     // planes
    dir.writeUInt16LE(32, p + 6);                    // bit count
    dir.writeUInt32LE(data.length, p + 8);           // size
    dir.writeUInt32LE(offset, p + 12);               // offset
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const ico = makeIco([
  { size: 256, data: pngs[256] },
  { size: 48, data: pngs[48] },
  { size: 32, data: pngs[32] },
  { size: 16, data: pngs[16] }
]);
const icoFile = path.join(assetsDir, 'icon.ico');
fs.writeFileSync(icoFile, ico);
console.log('written', icoFile);
