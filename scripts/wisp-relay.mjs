// Minimal WISP v1 TCP transport for local development. Guest TLS remains end-to-end.
// Uses only Node built-ins. Never deployed to GitHub Pages.
import { createHash } from "node:crypto";
import net from "node:net";
import { lookup } from "node:dns/promises";

export function websocketFrame(payload, opcode = 2) {
  const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (header.length === 2) header[1] = payload.length;
  else if (header.length === 4) { header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}

export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
      a === 198 && [18, 19].includes(b));
  }
  // Prefer IPv4; this also excludes mapped/loopback/link-local IPv6 destinations.
  return false;
}

export function acceptWisp(request, socket, head = Buffer.alloc(0), { origin, connect = options => net.createConnection(options), resolve = host => lookup(host, { family: 4 }) } = {}) {
  if (request.url !== "/wisp/" || request.headers.origin !== origin ||
      request.headers.upgrade?.toLowerCase() !== "websocket" || request.headers["sec-websocket-version"] !== "13" ||
      Buffer.from(request.headers["sec-websocket-key"] || "", "base64").length !== 16) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
  }
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const streams = new Map();
  let input = Buffer.alloc(0), fragments = [], fragmentBytes = 0, closed = false;
  const send = payload => { if (!closed) socket.write(websocketFrame(payload)); };
  const packet = (type, id, data = Buffer.alloc(0)) => { const header = Buffer.alloc(5); header[0] = type; header.writeUInt32LE(id, 1); return Buffer.concat([header, data]); };
  const credit = id => { const value = Buffer.alloc(4); value.writeUInt32LE(128); send(packet(3, id, value)); };
  const endStream = (id, reason = 2) => {
    const stream = streams.get(id);
    if (!stream) return;
    streams.delete(id); stream.tcp?.destroy(); send(packet(4, id, Buffer.from([reason])));
  };
  const close = () => { if (closed) return; closed = true; for (const stream of streams.values()) stream.tcp?.destroy(); streams.clear(); socket.destroy(); };
  socket.on("close", close); socket.on("error", close);
  socket.on("drain", () => { for (const stream of streams.values()) stream.tcp?.resume(); });
  credit(0);
  async function message(data) {
    if (data.length < 5) return close();
    const type = data[0], id = data.readUInt32LE(1);
    if (!id) return close();
    if (type === 1) {
      if (data.length < 9 || data[5] !== 1 || streams.has(id) || streams.size >= 64) return close();
      const port = data.readUInt16LE(6), hostname = data.subarray(8).toString("utf8");
      if (!port || hostname.length > 253 || !/^[a-z0-9.:-]+$/i.test(hostname)) return close();
      const stream = { tcp: null, queue: [], bytes: 0, packets: 0 };
      streams.set(id, stream);
      try {
        const { address } = await resolve(hostname);
        if (!publicAddress(address)) throw new Error("Destination is not on the public internet");
        if (closed || !streams.has(id)) return;
        const tcp = stream.tcp = connect({ host: address, port });
        tcp.setTimeout(120000, () => endStream(id, 3));
        tcp.on("connect", () => { for (const chunk of stream.queue) tcp.write(chunk); stream.queue = []; stream.bytes = 0; });
        tcp.on("data", chunk => { send(packet(2, id, chunk)); if (socket.writableLength > 2 * 1024 * 1024) tcp.pause(); });
        tcp.on("end", () => endStream(id)); tcp.on("error", () => endStream(id, 3));
        tcp.on("close", () => endStream(id));
      } catch { endStream(id, 3); }
    } else if (type === 2) {
      const stream = streams.get(id);
      if (!stream) return;
      const chunk = data.subarray(5);
      if (stream.tcp && !stream.tcp.connecting) {
        if (stream.tcp.writableLength > 4 * 1024 * 1024) return endStream(id, 3);
        stream.tcp.write(chunk);
      } else {
        stream.bytes += chunk.length;
        if (stream.bytes > 2 * 1024 * 1024) return endStream(id, 3);
        stream.queue.push(Buffer.from(chunk));
      }
      if (++stream.packets % 64 === 0) credit(id);
    } else if (type === 4) endStream(id);
    else if (type !== 3) close();
  }
  function receive(chunk) {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 2 && !closed) {
      const final = !!(input[0] & 0x80), opcode = input[0] & 15, masked = !!(input[1] & 0x80);
      if (!masked || input[0] & 0x70) return close();
      let size = input[1] & 127, offset = 2;
      if (size === 126) { if (input.length < 4) return; size = input.readUInt16BE(2); offset = 4; }
      else if (size === 127) { if (input.length < 10) return; const big = input.readBigUInt64BE(2); if (big > 2n * 1024n * 1024n) return close(); size = Number(big); offset = 10; }
      if (size > 2 * 1024 * 1024 || input.length > 5 * 1024 * 1024) return close();
      if (opcode >= 8 && (!final || size > 125)) return close();
      if (input.length < offset + 4 + size) return;
      const mask = input.subarray(offset, offset + 4), data = Buffer.from(input.subarray(offset + 4, offset + 4 + size));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      input = input.subarray(offset + 4 + size);
      if (opcode === 8) return close();
      if (opcode === 9) { socket.write(websocketFrame(data, 10)); continue; }
      if (opcode === 10) continue;
      if (![0, 2].includes(opcode) || opcode === 0 && !fragments.length || opcode === 2 && fragments.length) return close();
      fragments.push(data); fragmentBytes += data.length;
      if (fragmentBytes > 2 * 1024 * 1024) return close();
      if (final) { const complete = Buffer.concat(fragments); fragments = []; fragmentBytes = 0; message(complete).catch(close); }
    }
  }
  socket.on("data", receive);
  if (head.length) receive(head);
}
