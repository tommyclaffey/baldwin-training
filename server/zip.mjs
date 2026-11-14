// A small ZIP writer (and reader, for the tests), so a company's data export is one file without a new dependency.
// Deflate from node:zlib, CRC-32 from zlib.crc32 (Node 22.2+). Files under 4 GB each, fewer than 65,535 of them: no ZIP64.
import zlib from 'node:zlib';

const DOS_EPOCH = (d) => {
  const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const day = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { t, day };
};

/** files: [{ name, data: string | Buffer }] → a ZIP as one Buffer. Names are UTF-8 (flag bit 11). */
export function zip(files, at = new Date()) {
  const { t, day } = DOS_EPOCH(at);
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const packed = zlib.deflateRawSync(raw, { level: 6 });
    const stored = packed.length >= raw.length; // tiny files: keep as they are
    const body = stored ? raw : packed;
    const crc = zlib.crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(t, 10); head.writeUInt16LE(day, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(t, 12); dir.writeUInt16LE(day, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The reverse, for tests: a ZIP Buffer → Map(name → Buffer). Checks every CRC. */
export function unzip(buf) {
  const out = new Map();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (zlib.crc32(data) !== crc) throw new Error('bad crc: ' + name);
    out.set(name, data);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}
