const frame = document.querySelector("iframe"), output = document.querySelector("#results"), button = document.querySelector("button");
const log = text => { output.textContent += text + "\n"; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (check()) return; await pause(150); }
  throw new Error(`Timed out: ${label}`);
}
let commandId = 0;
async function command(app, text, label, timeout = 60000) {
  const id = ++commandId, marker = new RegExp(`NETCHECK_${id}:(\\d+)`);
  app.sendSerialOnly(`${text}; netcheck_status=$?; printf '\\nNETCHECK_%s:%s\\n' ${id} "$netcheck_status"\n`);
  await until(() => marker.test(app.document.querySelector("#terminalOutput")?.textContent || ""), label, timeout);
  const consoleText = app.document.querySelector("#terminalOutput").textContent;
  const status = consoleText.match(marker)?.[1];
  if (status !== "0") throw new Error(`${label} failed (${status}):\n${consoleText.slice(-7000)}`);
  log(`PASS ${label}`);
  return consoleText;
}
button.onclick = async () => {
  button.disabled = true; output.textContent = "";
  const app = frame.contentWindow;
  try {
    const services = await (await fetch("manual/network-fixture.json", { cache: "no-store" })).json();
    const status = await (await fetch("/utm-local-status.json", { cache: "no-store" })).json();
    if (status.internet !== "ethernet") throw new Error("Start the local server with QEMU networking first.");
    for (const architecture of ["x86_64", "arm64"]) {
      const directory = architecture === "arm64" ? "aarch64" : architecture;
      const files = {};
      for (const [role, name] of [["kernel", "vmlinuz-virt"], ["initrd", "initramfs-network"]]) {
        const response = await fetch(`manual/${directory}/${name}`);
        if (!response.ok) throw new Error("Networking test media is missing.");
        files[role] = await app.importFileToStore(new app.File([await response.blob()], name), role);
      }
      const vm = { name: `Network verification ${architecture}`, runtime: "local-v64", architecture,
        machine: architecture === "arm64" ? "virt" : "i440fx", memory: 512, vgaMemory: 8, cpu: 2, bootType: "kernel",
        displayMode: "serial", saveOnStop: false, network: "local", fileRefs: files,
        bootArguments: `console=${architecture === "arm64" ? "ttyAMA0" : "ttyS0"} rdinit=/bin/sh` };
      await app.importConfig({ files: [{ text: async () => JSON.stringify({ vm }) }] });
      app.runVM(app.vmById().id);
      await until(() => /can't access tty|~ #|\/ #/.test(app.document.querySelector("#terminalOutput")?.textContent || ""), `${architecture} Linux shell`);
      log(`PASS ${architecture}: Linux CPU and RAM run in visiting browser (${location.host})`);
      await command(app, "/usr/bin/busybox --install -s /usr/bin; export PATH=/usr/bin:/usr/sbin:/bin:/sbin; mount -t proc proc /proc; mount -t sysfs sysfs /sys; mount -t devtmpfs devtmpfs /dev; mkdir -p /run /tmp; modprobe virtio_pci 2>/dev/null; modprobe virtio_mmio 2>/dev/null; modprobe virtio_net; ip link set eth0 up; udhcpc -i eth0 -n -q -t 5", `${architecture} DHCP`);
      await command(app, "ip addr show eth0; ip route; cat /etc/resolv.conf; netprobe resolve example.com", `${architecture} real DNS lookup`);
      await command(app, "netprobe dns-udp 10.0.2.3", `${architecture} UDP DNS through gateway`);
      await command(app, "netprobe dns-tcp 1.1.1.1", `${architecture} public TCP DNS`);
      await command(app, "ping -c 2 -W 3 10.0.2.2", `${architecture} ICMP gateway ping`);
      await command(app, `netprobe udp ${services.host} ${services.udp}`, `${architecture} LAN UDP: binary datagrams + fragmentation`);
      await command(app, `netprobe tcp ${services.host} ${services.tcp}`, `${architecture} LAN TCP: stream integrity`);
      await command(app, `wget -q -O /tmp/response http://${services.host}:${services.http}/probe; grep -q UTM_HTTP_OK /tmp/response`, `${architecture} LAN HTTP`);
      await command(app, "wget -q -T 30 -O /tmp/example https://example.com/; grep -q 'Example Domain' /tmp/example", `${architecture} public HTTPS`);
      await command(app, "printf 'GET / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n' | timeout 40 openssl s_client -ign_eof -ignore_unexpected_eof -connect example.com:443 -servername example.com -verify_hostname example.com -verify_return_error -CAfile /etc/ssl/cert.pem > /tmp/tls-response 2>/tmp/tls-check; grep -q 'HTTP/' /tmp/tls-response && grep -q 'Verification: OK\\|Verification OK' /tmp/tls-response", `${architecture} TLS certificate + hostname verification`, 70000);
      await command(app, "ip -6 addr show eth0; ip -6 route", `${architecture} IPv6 configuration`);
      try { await command(app, "netprobe resolve ipv6.google.com; ping -6 -c 1 -W 3 ipv6.google.com", `${architecture} external IPv6`, 30000); }
      catch (error) { log(`LIMIT ${architecture} external IPv6 depends on host route: ${error.message.split("\n")[0]}`); }
      await app.stopDisplay();
    }
    log("ALL REQUIRED NETWORK CHECKS PASSED");
  } catch (error) { log(`FAIL ${error.stack || error}`); }
  finally { button.disabled = false; }
};
