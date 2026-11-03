// Optional LAN echo endpoints for the real guest tests. No user files are served.
import net from "node:net";
import http from "node:http";
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";

const host = process.env.UTM_TEST_HOST || Object.values(networkInterfaces()).flat().find(item => item?.family === "IPv4" && !item.internal)?.address;
const tcp = net.createServer(socket => { socket.on("data", data => socket.write(data)); socket.on("error", () => {}); });
const udp = dgram.createSocket("udp4");
udp.on("message", (data, info) => udp.send(data, info.port, info.address));
const web = http.createServer((request, response) => {
  const data = request.url === "/bulk" ? Buffer.alloc(1024 * 1024, 65) : Buffer.from("UTM_HTTP_OK\n");
  response.writeHead(200, { "Content-Type": "text/plain", "Content-Length": data.length }); response.end(data);
});
await Promise.all([
  new Promise(resolve => tcp.listen(0, "0.0.0.0", resolve)),
  new Promise(resolve => udp.bind(0, "0.0.0.0", resolve)),
  new Promise(resolve => web.listen(0, "0.0.0.0", resolve))
]);
const fixture = { host, tcp: tcp.address().port, udp: udp.address().port, http: web.address().port };
await mkdir(new URL("manual/", import.meta.url), { recursive: true });
await writeFile(new URL("manual/network-fixture.json", import.meta.url), JSON.stringify(fixture, null, 2));
console.log("LAN test services:", JSON.stringify(fixture));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { tcp.close(); udp.close(); web.close(); });
