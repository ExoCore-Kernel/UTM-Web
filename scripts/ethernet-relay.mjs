// Raw Ethernet over WebSocket -> QEMU's socket/hub/user network stack.
// The VM CPU stays in the browser; QEMU runs no guest CPU, disk or OS here.
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { websocketFrame } from "./wisp-relay.mjs";

const MAX_FRAME = 65536;
export function findQemu(command = process.env.UTM_QEMU || "qemu-system-x86_64") {
  const result = spawnSync(command, ["-netdev", "help"], { encoding: "utf8", timeout: 10000 });
  return result.status === 0 && /^user$/m.test(result.stdout) ? command : null;
}

export function gatewayArguments(port, forwards = []) {
  for (const forward of forwards) {
    if (!/^(tcp|udp):127\.0\.0\.1:[1-9][0-9]{0,4}-:[1-9][0-9]{0,4}$/.test(forward)) throw new Error("Invalid loopback port forwarding rule.");
    const ports = forward.match(/:(\d+)-:(\d+)$/).slice(1).map(Number);
    if (ports.some(value => value > 65535)) throw new Error("Forwarded ports must be between 1 and 65535.");
  }
  return ["-machine", "none", "-nodefaults", "-display", "none", "-monitor", "none", "-serial", "none",
    "-netdev", `user,id=nat,ipv4=on,ipv6=on${forwards.map(value => `,hostfwd=${value}`).join("")}`,
    "-netdev", "hubport,id=natlink,hubid=0,netdev=nat",
    "-netdev", `socket,id=wire,connect=127.0.0.1:${port}`,
    "-netdev", "hubport,id=wirelink,hubid=0,netdev=wire"];
}

export async function openGateway({ command, forwards = [], onFrame, onError }) {
  let child, wire, closed = false, buffer = Buffer.alloc(0), stderr = "";
  const server = net.createServer();
  const close = () => {
    if (closed) return;
    closed = true;
    wire?.destroy();
    server.close();
    child?.kill("SIGTERM");
    const timer = setTimeout(() => { if (child?.exitCode === null) child.kill("SIGKILL"); }, 2000);
    timer.unref();
  };
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("QEMU network gateway timed out.")), 10000);
      const fail = error => { clearTimeout(timer); reject(error); };
      server.once("connection", socket => {
        wire = socket; clearTimeout(timer); server.close();
        socket.on("error", error => { if (!closed) onError?.(error); });
        socket.on("close", () => { if (!closed) onError?.(new Error("Network gateway disconnected.")); });
        socket.on("data", chunk => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const length = buffer.readUInt32BE(0);
            if (length < 14 || length > MAX_FRAME) { onError?.(new Error("Invalid Ethernet frame from gateway.")); close(); return; }
            if (buffer.length < length + 4) return;
            onFrame(Buffer.from(buffer.subarray(4, length + 4)));
            buffer = buffer.subarray(length + 4);
          }
        });
        resolve();
      });
      child = spawn(command, gatewayArguments(server.address().port, forwards), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
      child.once("error", fail);
      child.once("exit", code => {
        if (closed) return;
        const detail = stderr.replace(/^.*warning: hub 0 with no nics\n/m, "").trim();
        const error = new Error(`QEMU network gateway exited (${code}). ${detail}`);
        fail(error); if (wire) onError?.(error);
      });
    });
    await connected;
    return {
      pid: child.pid, close,
      send(frame) {
        if (closed || !wire || frame.length < 14 || frame.length > MAX_FRAME) return;
        if (wire.writableLength > 8 * 1024 * 1024) { onError?.(new Error("Network send buffer is full.")); close(); return; }
        const prefix = Buffer.alloc(4); prefix.writeUInt32BE(frame.length);
        wire.write(Buffer.concat([prefix, frame]));
      },
      pause() { wire?.pause(); }, resume() { wire?.resume(); }
    };
  } catch (error) { close(); throw error; }
}

export async function acceptEthernet(request, socket, head = Buffer.alloc(0), { origin, command, forwards = [], onClose = () => {} } = {}) {
  if (request.url !== "/net/" || request.headers.origin !== origin || request.headers.upgrade?.toLowerCase() !== "websocket" ||
      request.headers["sec-websocket-version"] !== "13" || Buffer.from(request.headers["sec-websocket-key"] || "", "base64").length !== 16) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); onClose(); return;
  }
  let gateway, closed = false, upgraded = false, input = Buffer.alloc(0), fragments = [], fragmentBytes = 0;
  const close = () => { if (closed) return; closed = true; gateway?.close(); socket.destroy(); onClose(); };
  socket.once("close", close); socket.on("error", close);
  try {
    gateway = await openGateway({ command, forwards,
      onFrame: frame => {
        if (closed || !upgraded) return;
        if (!socket.write(websocketFrame(frame))) gateway.pause();
      },
      onError: error => {
        if (closed) return;
        console.error(error.message);
        if (upgraded) {
          const reason = Buffer.alloc(2); reason.writeUInt16BE(1011);
          socket.write(websocketFrame(Buffer.concat([reason, Buffer.from("Network gateway stopped")]), 8));
        }
        close();
      }
    });
    if (closed) { gateway.close(); return; }
    const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    upgraded = true;
    socket.on("drain", () => gateway.resume());
    function receive(chunk) {
      input = Buffer.concat([input, chunk]);
      while (!closed && input.length >= 2) {
        const final = !!(input[0] & 128), opcode = input[0] & 15;
        if (!(input[1] & 128) || input[0] & 0x70) return close();
        let size = input[1] & 127, offset = 2;
        if (size === 126) { if (input.length < 4) return; size = input.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (input.length < 10) return; const big = input.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) return close(); size = Number(big); offset = 10; }
        if (size > MAX_FRAME || opcode >= 8 && (!final || size > 125)) return close();
        if (input.length < offset + 4 + size) return;
        const mask = input.subarray(offset, offset + 4), data = Buffer.from(input.subarray(offset + 4, offset + 4 + size));
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        input = input.subarray(offset + 4 + size);
        if (opcode === 8) return close();
        if (opcode === 9) { socket.write(websocketFrame(data, 10)); continue; }
        if (opcode === 10) continue;
        if (![0, 2].includes(opcode) || opcode === 0 && !fragments.length || opcode === 2 && fragments.length) return close();
        fragments.push(data); fragmentBytes += data.length;
        if (fragmentBytes > MAX_FRAME) return close();
        if (final) { gateway.send(Buffer.concat(fragments)); fragments = []; fragmentBytes = 0; }
      }
    }
    socket.on("data", receive);
    if (head.length) receive(head);
    return close;
  } catch (error) {
    if (!closed) console.error(error.message);
    if (!upgraded && !closed) socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nQEMU network gateway unavailable");
    close();
  }
}
