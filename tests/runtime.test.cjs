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

test("existing VM media and hardware survive a real app load, including the editable default VM", () => {
  const saved = { selectedId: "custom-pc", vms: [
    { id: "custom-pc", name: "My edited PC", runtime: "local-v86", architecture: "x86", memory: 256, fileRefs: { cdrom: { id: "iso-1", name: "linux.iso" } } },
    { id: "arm", name: "My ARM VM", runtime: "local-v64", architecture: "arm64", cpu: 4 }
  ] };
  const elements = new Map();
  const context = vm.createContext({
    UTMRuntime: R, UTMStorage: { estimate: async () => ({}) }, structuredClone, TextDecoder, TextEncoder, crypto: webcrypto, console,
    localStorage: { getItem: key => key === "utm-web-state" ? JSON.stringify(saved) : null },
    window: { isSecureContext: false }, navigator: {}, crossOriginIsolated: false,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { classList: { toggle() {} }, setAttribute() {} });
      return elements.get(id);
    } }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../app.js"), "utf8"), context);
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
