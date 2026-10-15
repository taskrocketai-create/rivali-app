// Derived from Alan's RS3 captures, September 19–20, 2026.
// This module implements logo operations only, not firmware updates.
export const HOST = '10.0.0.1';
export const PORT = 2000;
const ascii = (s: string) => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
export function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
export function frame(body: Uint8Array, command = false) {
  const out = new Uint8Array(body.length + 20);
  out.set(ascii(command ? '<hSTNC' : '<hSTCP'));
  new DataView(out.buffer).setUint32(6, body.length, true);
  out[11] = 62; out.set(body, 12);
  out.set(ascii(command ? '<STNC' : '<STCP'), 12 + body.length);
  new DataView(out.buffer).setUint16(17 + body.length, body.reduce((n, v) => n + v, 0) & 65535, true);
  out[out.length - 1] = 62;
  return out;
}
export function command(code: number, group: number, size = 0, mode = 0, path = '') {
  const b = new Uint8Array(64); const v = new DataView(b.buffer);
  v.setUint32(8, code, true); v.setUint32(10, group, true);
  v.setUint32(16, size, true); v.setUint32(24, mode, true);
  b.set(ascii(path), 32);
  return frame(b, true);
}
export const handshake = () => frame(Uint8Array.of(0, 0, 0, 0, 6, 8, 0, 0));
export const ack = () => frame(new Uint8Array(4));
export const openLogo = (size: number) => command(1, 4, size, 3, '0:/lgo.N/splash.bmp');
export const commitLogo = () => { const f = command(257, 6, 0, 1); const b = f.slice(12, 76); b[32] = 1; return frame(b, true); };
export const finalizeLogo = () => command(9, 0);
export const readLogo = () => command(2, 4, 0, 1, '0:/lgo/splash.bmp');
export function validateBmp(b: Uint8Array) {
  if (b.length !== 4158 || b[0] !== 66 || b[1] !== 77) throw new Error('Expected a 227 × 128 monochrome BMP (4158 bytes).');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(2, true) !== b.length || v.getUint32(10, true) !== 62 ||
      v.getUint32(14, true) !== 40 || v.getInt32(18, true) !== 227 ||
      v.getInt32(22, true) !== 128 || v.getUint16(26, true) !== 1 ||
      v.getUint16(28, true) !== 1 || v.getUint32(30, true) !== 0) {
    throw new Error('This BMP does not match the verified MyChron 5S format.');
  }
}
export class FrameDecoder {
  private pending = new Uint8Array(0);
  push(chunk: Uint8Array): Uint8Array[] {
    this.pending = join(this.pending, chunk); const bodies: Uint8Array[] = [];
    while (this.pending.length >= 12) {
      const p = this.pending;
      if (String.fromCharCode(...p.slice(0, 6)) !== '<hSTCP' || p[11] !== 62) throw new Error('Unexpected MyChron response header.');
      const n = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(6, true);
      if (n < 4 || n > 65536) throw new Error('Invalid MyChron response length.');
      if (p.length < n + 20) break;
      const b = p.slice(12, 12 + n); const tail = p.slice(12 + n, 20 + n);
      const sum = b.reduce((s, x) => s + x, 0) & 65535;
      if (String.fromCharCode(...tail.slice(0, 5)) !== '<STCP' || tail[7] !== 62 ||
          tail[5] + tail[6] * 256 !== sum) throw new Error('MyChron response checksum failed.');
      bodies.push(b); this.pending = p.slice(n + 20);
    }
    return bodies;
  }
}
