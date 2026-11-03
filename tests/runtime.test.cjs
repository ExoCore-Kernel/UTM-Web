const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");
require("../runtime-config.js");
const R = globalThis.UTMRuntime;
const machine = arch => R.normalize({ architecture: arch, memory: 128, cpu: 2, vgaMemory: 8, network: "none" });

test("x64 reaches the long-mode CPU with ACPI, UEFI and Q35 available", () => {
  const config = R.options({ ...machine("x86_64"), firmware: "uefi", machine: "q35" });
  assert.equal(config.cpu_type, "x86_64");
  assert.equal(config.cpu_cores, 2);
  assert.equal(config.experimental_smp_jit, true);
  assert.equal(config.acpi, true);
  assert.equal(config.machine_type, "q35");
  assert.equal(config.firmware.type, "uefi");
  assert.equal(config.bios, undefined);
  assert.equal(config.vga_memory_size, undefined); // rejected by v64
  assert.equal(config.vram_size, 8 * 1024 * 1024);
});

test("ARM options use their own Wasm core, kernel and virtio devices, without PC firmware", () => {
  for (const arch of ["arm64", "arm32"]) {
    const instance = machine(arch);
    instance.fileRefs.disk = { name: "alpine.qcow2" };
    const config = R.options(instance, { kernel: { url: "Image" }, disk: { url: "disk" } });
    assert.equal(config.cpu_type, arch);
    assert.equal(config.machine_type, "virt");
    assert.match(config.wasm_path, /v86-arm64.wasm$/);
    assert.equal(config.kernel.url, "Image");
    assert.equal(config.virtio_disks[0].format, "qcow2");
    for (const key of ["bios", "vga_bios", "bzimage", "cdrom", "fda", "hda", "acpi", "audio_device"]) assert.equal(config[key], undefined);
  }
});

test("configuration refuses invalid RAM, cores, board and stale snapshots before allocating a VM", () => {
  for (const memory of [NaN, 0, 1537, 1.5]) assert.throws(() => R.options({ ...machine("x86"), memory }), /RAM/);
  for (const cpu of [0, 9, 1.5]) assert.throws(() => R.options({ ...machine("x86"), cpu }), /cores/);
  assert.throws(() => R.options({ ...machine("arm64"), machine: "q35" }), /machine/);
  assert.throws(() => R.options({ ...machine("arm64"), bootType: "iso" }), /kernel/);
  const instance = machine("x86_64");
  instance.fileRefs.state = { runtime: "local-v64", machineConfig: R.signature(instance) };
  assert.doesNotThrow(() => R.options(instance));
  assert.throws(() => R.options({ ...instance, cpu: 4 }), /different hardware/);
  instance.fileRefs.state.runtime = "local-v86";
  assert.throws(() => R.options(instance), /previous v86/);
});

test("disk formats are passed to the image decoder and all URLs respect a Pages subdirectory", () => {
  for (const ext of ["raw", "img", "qcow2", "vhd", "vdi", "vmdk", "vhdx"]) {
    const instance = machine("x86");
    instance.fileRefs.disk = { name: `disk.${ext.toUpperCase()}` };
    const config = R.options(instance, { disk: { buffer: new ArrayBuffer(512) } }, path => new URL(path, "https://example.github.io/UTM-Web/").href);
    assert.equal(config.hda.format, ["raw", "img"].includes(ext) ? "raw" : ext);
    assert.match(config.wasm_path, /^https:\/\/example.github.io\/UTM-Web\/vendor\/v64\//);
    assert.match(config.cpu_worker_url, /\/UTM-Web\/vendor\/v64\/build\/cpu-worker.js$/);
    assert.equal(config.net_device.type, "none");
  }
});

test("Pages uses limited browser HTTP; native HTTPS relay is available only in confirmed local mode", () => {
  const instance = { ...machine("x86_64"), network: "auto" };
  R.localRelayAvailable = false;
  assert.equal(R.options(instance).net_device.relay_url, "fetch");
  assert.equal(R.options(instance).net_device.type, "virtio");
  assert.throws(() => R.options({ ...instance, network: "local" }), /local server/);
  globalThis.location = { host: "127.0.0.1:4174", protocol: "http:" };
  R.localRelayAvailable = true;
  assert.equal(R.options(instance).net_device.relay_url, "ws://127.0.0.1:4174/net/");
  R.localRelayAvailable = false;
  delete globalThis.location;
});

function loadApp(saved = null) {
  const elements = new Map();
  const context = vm.createContext({
    URL, UTMRuntime: R, UTMStorage: { estimate: async () => ({}) }, structuredClone, TextDecoder, TextEncoder, crypto: webcrypto, console,
    localStorage: { getItem: key => key === "utm-web-state" ? JSON.stringify(saved) : null },
    window: { isSecureContext: false }, navigator: {}, crossOriginIsolated: false,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { classList: { toggle() {} }, setAttribute() {} });
      return elements.get(id);
    } }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../app.js"), "utf8"), context);
  return context;
}

test("existing VM media and hardware survive a real app load, including the editable default VM", () => {
  const saved = { selectedId: "custom-pc", vms: [
    { id: "custom-pc", name: "My edited PC", runtime: "local-v86", architecture: "x86", memory: 256, fileRefs: { cdrom: { id: "iso-1", name: "linux.iso" } } },
    { id: "arm", name: "My ARM VM", runtime: "local-v64", architecture: "arm64", cpu: 4 }
  ] };
  const context = loadApp(saved);
  assert.equal(context.vmById("custom-pc").name, "My edited PC");
  assert.equal(context.vmById("custom-pc").fileRefs.cdrom.id, "iso-1");
  assert.equal(context.vmById("arm").architecture, "arm64");
  assert.equal(context.vmById("arm").cpu, 4);
});

test("vendored files match their pinned checksums and both CPU cores are valid WebAssembly", () => {
  const root = require("node:path").join(__dirname, "../vendor/v64");
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`));
  for (const [file, hash] of Object.entries(manifest.sha256)) {
    const bytes = fs.readFileSync(`${root}/${file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, file);
    if (file.endsWith(".wasm")) assert.ok(WebAssembly.validate(bytes), file);
  }
});


test("home-screen install downloads a named profile without navigating to XML", () => {
  for (const page of ["https://example.github.io/UTM-Web/index.html?test=1", "http://192.168.1.5:4173/", "file:///tmp/UTM-Web/index.html"]) {
    const context = loadApp();
    let clicked = false, removed = false, attached;
    context.window.location = { href: page, assign() { throw new Error("Must download without navigating"); } };
    context.document.body = { appendChild(link) { attached = link; } };
    context.document.createElement = tag => {
      assert.equal(tag, "a");
      return { click() { clicked = true; }, remove() { removed = true; } };
    };
    context.downloadHomeScreenProfile();
    assert.equal(attached.href, new URL("UTM.mobileconfig", page).href);
    assert.equal(attached.download, "UTM.mobileconfig");
    assert.equal(attached.type, "application/x-apple-aspen-config");
    assert.ok(clicked && removed);
    assert.equal(context.window.location.href, page);
  }
});

test("profile responses use Apple MIME and attachment headers, including offline cache", async () => {
  const source = fs.readFileSync(require.resolve("../coi-serviceworker.js"), "utf8");
  for (const offline of [false, true]) {
    const handlers = {};
    const original = new Response("<?xml version=\"1.0\"?><plist/>", { headers: { "Content-Type": "text/plain" } });
    const context = vm.createContext({
      URL, Headers, Response,
      self: { registration: { scope: "https://example.github.io/UTM-Web/" }, location: { origin: "https://example.github.io" }, addEventListener(name, handler) { handlers[name] = handler; } },
      fetch: async () => { if (offline) throw new Error("Offline"); return original.clone(); },
      caches: { open: async () => ({ put: async () => {}, match: async () => original.clone() }) }
    });
    vm.runInContext(source, context);
    for (const [pathname, profile] of [["/UTM-Web/UTM.mobileconfig", true], ["/another-project/UTM.mobileconfig", false], ["/UTM-Web/notes.txt", false]]) {
      let responsePromise;
      handlers.fetch({ request: new Request("https://example.github.io" + pathname), respondWith(value) { responsePromise = value; } });
      const response = await responsePromise;
      assert.equal(response.headers.get("Content-Type"), profile ? "application/x-apple-aspen-config" : "text/plain");
      assert.equal(response.headers.get("Content-Disposition"), profile ? 'attachment; filename="UTM.mobileconfig"' : null);
      assert.equal(await response.text(), '<?xml version="1.0"?><plist/>');
    }
  }
});
