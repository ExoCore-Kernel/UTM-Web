import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { acceptEthernet, findQemu, gatewayArguments, openGateway } from "../scripts/ethernet-relay.mjs";

test("gateway has no VM CPU or disks and validates loopback port forwards", () => {
  const args = gatewayArguments(12345, ["tcp:127.0.0.1:2222-:22", "udp:127.0.0.1:5353-:5353"]);
  assert.deepEqual(args.slice(0, 2), ["-machine", "none"]);
  assert.ok(args.some(value => value.includes("user,id=nat,ipv4=on,ipv6=on")));
  assert.equal(args.includes("-drive"), false);
  assert.throws(() => gatewayArguments(1, ["tcp:0.0.0.0:2222-:22"]), /Invalid/);
  assert.throws(() => gatewayArguments(1, ["tcp:127.0.0.1:99999-:22"]), /65535/);
});

test("Ethernet WebSocket rejects an unrelated origin before starting a gateway", async () => {
  class Socket extends EventEmitter { end(data) { this.response = data; } }
  const socket = new Socket(); let closed = false;
  await acceptEthernet({ url: "/net/", headers: { origin: "http://foreign.example" } }, socket, undefined,
    { origin: "http://localhost:4173", command: "must-not-start", onClose: () => { closed = true; } });
  assert.match(socket.response, /403/);
  assert.ok(closed);
});

function discover() {
  const mac = Buffer.from([0x52, 0x54, 0, 0x12, 0x34, 0x56]);
  const options = Buffer.from([53, 1, 1, 55, 3, 1, 3, 6, 255]);
  const frame = Buffer.alloc(14 + 20 + 8 + 300);
  frame.fill(255, 0, 6); mac.copy(frame, 6); frame.writeUInt16BE(0x0800, 12);
  const ip = frame.subarray(14, 34); ip[0] = 0x45; ip.writeUInt16BE(frame.length - 14, 2); ip[8] = 64; ip[9] = 17; ip.fill(255, 16, 20);
  let sum = 0; for (let i = 0; i < 20; i += 2) sum += ip.readUInt16BE(i);
  while (sum >>> 16) sum = (sum & 65535) + (sum >>> 16);
  ip.writeUInt16BE(~sum & 65535, 10);
  frame.writeUInt16BE(68, 34); frame.writeUInt16BE(67, 36); frame.writeUInt16BE(frame.length - 34, 38);
  const bootp = 42; frame[bootp] = 1; frame[bootp + 1] = 1; frame[bootp + 2] = 6;
  frame.writeUInt32BE(0x12345678, bootp + 4); frame.writeUInt16BE(0x8000, bootp + 10);
  mac.copy(frame, bootp + 28); frame.writeUInt32BE(0x63825363, bootp + 236); options.copy(frame, bootp + 240);
  return frame;
}

const command = findQemu();
test("real QEMU Ethernet gateway returns a DHCP lease and closes its child process", { skip: !command, timeout: 15000 }, async () => {
  let resolveOffer;
  const offered = new Promise(resolve => { resolveOffer = resolve; });
  const gateway = await openGateway({ command, onFrame: frame => {
    if (frame.length > 282 && frame.readUInt16BE(12) === 0x0800 && frame[23] === 17 && frame.readUInt16BE(34) === 67 && frame.readUInt32BE(46) === 0x12345678) resolveOffer(frame);
  }, onError: error => { throw error; } });
  try {
    gateway.send(discover());
    const frame = await Promise.race([offered, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("No DHCP response")), 5000); timer.unref(); })]);
    assert.equal(frame.subarray(58, 62).join("."), "10.0.2.15");
    assert.equal(frame.readUInt32BE(278), 0x63825363);
  } finally { gateway.close(); }
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.throws(() => process.kill(gateway.pid, 0), /ESRCH/);
});
