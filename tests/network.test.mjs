import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { acceptWisp, publicAddress, websocketFrame } from "../scripts/wisp-relay.mjs";

class Socket extends EventEmitter {
  writes = []; writableLength = 0; connecting = false;
  write(data) { this.writes.push(Buffer.from(data)); return true; }
  end(data) { if (data) this.write(data); this.destroy(); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } }
  setTimeout() {} pause() {} resume() {}
}
function maskedFrame(payload) {
  const frame = websocketFrame(payload);
  const offset = frame.length - payload.length;
  frame[1] |= 128;
  const mask = Buffer.from([31, 42, 53, 64]);
  const data = Buffer.from(payload);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([frame.subarray(0, offset), mask, data]);
}
function wisp(type, id, data) {
  const header = Buffer.alloc(5); header[0] = type; header.writeUInt32LE(id, 1);
  return Buffer.concat([header, data]);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = origin => ({ url: "/wisp/", headers: { origin, upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": Buffer.alloc(16, 7).toString("base64") } });

test("local WISP relay preserves end-to-end TLS bytes in both directions", async () => {
  const browser = new Socket(), tcp = new Socket();
  let destination;
  acceptWisp(request("http://127.0.0.1:4173"), browser, Buffer.alloc(0), {
    origin: "http://127.0.0.1:4173", resolve: async () => ({ address: "93.184.216.34" }),
    connect: options => { destination = options; return tcp; }
  });
  assert.match(browser.writes[0].toString(), /101 Switching Protocols/);
  const settings = Buffer.alloc(3); settings[0] = 1; settings.writeUInt16LE(443, 1);
  browser.emit("data", maskedFrame(wisp(1, 1, Buffer.concat([settings, Buffer.from("example.com")]))));
  await tick(); tcp.emit("connect");
  assert.deepEqual(destination, { host: "93.184.216.34", port: 443 });
  const tlsHello = Buffer.from([0x16, 0x03, 0x03, 0, 4, 1, 2, 3, 4]);
  const fragmented = maskedFrame(wisp(2, 1, tlsHello));
  browser.emit("data", fragmented.subarray(0, 4)); browser.emit("data", fragmented.subarray(4));
  assert.deepEqual(tcp.writes.at(-1), tlsHello);
  const encryptedReply = Buffer.from([0x17, 0x03, 0x03, 0, 3, 5, 6, 7]);
  tcp.emit("data", encryptedReply);
  assert.deepEqual(browser.writes.at(-1), websocketFrame(wisp(2, 1, encryptedReply)));
  browser.emit("data", maskedFrame(wisp(4, 1, Buffer.from([2]))));
  assert.ok(tcp.destroyed);
  browser.destroy();
});

test("relay accepts only its local app origin and rejects private-network destinations", async () => {
  const foreign = new Socket();
  acceptWisp(request("https://unrelated.example"), foreign, undefined, { origin: "http://127.0.0.1:4173" });
  assert.match(foreign.writes[0].toString(), /403 Forbidden/);
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1"]) assert.equal(publicAddress(address), false);
  assert.equal(publicAddress("1.1.1.1"), true);
  const browser = new Socket(); let connected = false;
  acceptWisp(request("http://localhost:4173"), browser, undefined, {
    origin: "http://localhost:4173", resolve: async () => ({ address: "127.0.0.1" }), connect: () => { connected = true; return new Socket(); }
  });
  const settings = Buffer.from([1, 0xbb, 1]);
  browser.emit("data", maskedFrame(wisp(1, 1, Buffer.concat([settings, Buffer.from("localhost")]))));
  await tick(); assert.equal(connected, false);
  assert.deepEqual(browser.writes.at(-1), websocketFrame(wisp(4, 1, Buffer.from([3]))));
  browser.destroy();
});

test("relay rejects unmasked WebSocket client frames", () => {
  const browser = new Socket();
  acceptWisp(request("http://localhost:4173"), browser, undefined, { origin: "http://localhost:4173" });
  browser.emit("data", websocketFrame(wisp(4, 1, Buffer.from([2]))));
  assert.ok(browser.destroyed);
});
