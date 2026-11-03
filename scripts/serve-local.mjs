#!/usr/bin/env node
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, networkInterfaces } from "node:os";
import { acceptWisp } from "./wisp-relay.mjs";
import { acceptEthernet, findQemu, gatewayArguments } from "./ethernet-relay.mjs";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.env.UTM_PORT || 4173);
const lan = process.argv.includes("--lan");
if (process.argv.some(value => value === "--help" || value === "-h")) {
  console.log("Usage: node scripts/serve-local.mjs [--lan]\nUTM_PORT changes the HTTP port. UTM_QEMU selects QEMU. UTM_HOSTFWD adds loopback port forwarding.");
  process.exit(0);
}
const qemu = findQemu();
const forwards = (process.env.UTM_HOSTFWD || "").split(";").filter(Boolean);
gatewayArguments(1, forwards);
const connections = new Set();
const network = qemu ? {
  internet: "ethernet", version: 2, protocols: ["tcp", "udp", "dns", "dhcp", "ipv4", "ipv6"],
  gateway: "10.0.2.2", dns: "10.0.2.3", forwards,
  limits: "NAT; no Wi-Fi radio passthrough. External ICMP and IPv6 depend on host support. Inbound ports need forwarding."
} : { internet: false, error: "Install QEMU with its user networking backend (macOS: brew install qemu)." };
const types = { ".mobileconfig": "application/x-apple-aspen-config", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const lanAddresses = [...new Set(Object.values(networkInterfaces()).flat().filter(item => item?.family === "IPv4" && !item.internal).map(item => item.address))];
const allowedHosts = new Set(["127.0.0.1", "localhost", ...(lan ? [...lanAddresses, hostname().toLowerCase(), hostname().split(".")[0].toLowerCase() + ".local"] : [])]);
const validHost = value => {
  try { const url = new URL(`http://${value}`); return allowedHosts.has(url.hostname.toLowerCase()) && Number(url.port || 80) === port; }
  catch { return false; }
};
const server = http.createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cache-Control", "no-store");
  if (!validHost(request.headers.host)) { response.writeHead(403).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/utm-local-status.json") {
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(network)); return;
    }
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    if (pathname.split("/").some(part => part.startsWith(".")) || pathname.includes("/node_modules/")) { response.writeHead(404).end(); return; }
    const target = await realpath(path.join(root, pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const info = await stat(target);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", types[path.extname(target)] || "application/octet-stream");
    if (path.extname(target) === ".mobileconfig") response.setHeader("Content-Disposition", 'attachment; filename="UTM.mobileconfig"');
    response.setHeader("Content-Length", info.size);
    if (request.method === "HEAD") response.end();
    else createReadStream(target).on("error", () => response.destroy()).pipe(response);
  } catch { response.writeHead(404).end("Not found"); }
});
server.on("upgrade", (request, socket, head) => {
  if (!validHost(request.headers.host)) { socket.destroy(); return; }
  if (request.url === "/wisp/") { acceptWisp(request, socket, head, { origin: `http://${request.headers.host}` }); return; }
  if (!qemu || connections.size >= 16) { socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\nQEMU networking unavailable"); return; }
  connections.add(socket);
  acceptEthernet(request, socket, head, { origin: `http://${request.headers.host}`, command: qemu, forwards,
    onClose: () => connections.delete(socket) });
});
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? `Port ${port} is busy. Stop the other preview, or run UTM_PORT=4174 node scripts/serve-local.mjs` : error.message); process.exitCode = 1; });
server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`UTM Web: http://127.0.0.1:${port}/`);
  if (lan) for (const address of lanAddresses) console.log(`LAN: http://${address}:${port}/ — VM compute runs in the visiting browser`);
  console.log(qemu ? "Local Ethernet NAT enabled: TCP, UDP, DNS, DHCP and IPv6. Guest HTTPS is end-to-end." : network.error);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  for (const socket of connections) socket.destroy();
  server.close(() => { process.exitCode = 0; });
});
