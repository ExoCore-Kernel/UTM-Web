/* Shared by the static UI and the runtime verification scripts. */
(function (root) {
  "use strict";
  const base = "vendor/v64/";
  const MiB = 1024 * 1024;
  const architectures = ["x86", "x86_64", "arm64", "arm32"];
  const isARM = vm => ["arm64", "arm32"].includes(vm.architecture);
  const is64 = vm => ["x86_64", "arm64"].includes(vm.architecture);
  const maxMemory = vm => is64(vm) ? 32768 : vm.architecture === "x86" ? 2047 : 1536;
  function memoryOptions(vm) {
    // v64's memory_size is backed by wasm32 and cannot hold 32 GiB. Its
    // 64-bit cores expose additional host-backed RAM above physical 4 GiB.
    // Extended RAM is 2 MiB aligned; keep an odd final MiB in low RAM.
    const low = is64(vm) && vm.memory > 1536 ? 1536 + vm.memory % 2 : vm.memory;
    const extended = vm.memory - low;
    return { memory_size: low * MiB, ...(extended ? {
      extended_memory_size: extended * MiB,
      extended_memory_cache: Math.min(64, extended) * MiB
    } : {}) };
  }
  const bootTypes = vm => isARM(vm) ? ["kernel"] : ["iso", "disk", "floppy", "kernel"];
  const machineTypes = vm => isARM(vm) ? ["virt"] : ["i440fx", "q35"];

  function normalize(vm) {
    if (!vm || typeof vm !== "object" || Array.isArray(vm)) throw new Error("Invalid VM configuration.");
    const architecture = ({ i386: "x86", amd64: "x86_64", aarch64: "arm64" })[vm.architecture] || vm.architecture || "x86";
    if (!architectures.includes(architecture)) throw new Error(`Unsupported architecture: ${architecture}`);
    const arm = isARM({ architecture });
    return {
      ...vm,
      runtime: "local-v64",
      architecture,
      machine: arm ? "virt" : (vm.machine === "q35" ? "q35" : "i440fx"),
      firmware: architecture === "x86_64" && vm.firmware === "uefi" ? "uefi" : "seabios",
      memory: Number(vm.memory ?? 512),
      cpu: Number(vm.cpu ?? 1),
      vgaMemory: Number(vm.vgaMemory ?? 32),
      bootType: arm ? "kernel" : (vm.bootType === "packaged-demo" ? "iso" : vm.bootType || "iso"),
      displayMode: vm.displayMode === "serial" ? "serial" : "graphical",
      bootArguments: String(vm.bootArguments || (arm ? "console=ttyAMA0" : "")),
      network: ["auto", "none", "browser", "local"].includes(vm.network) ? vm.network : "auto",
      saveOnStop: vm.saveOnStop !== false,
      fileRefs: { ...(vm.fileRefs || {}) },
      status: "Stopped"
    };
  }

  function validate(vm) {
    if (!architectures.includes(vm.architecture)) throw new Error("Choose a supported CPU architecture.");
    if (!machineTypes(vm).includes(vm.machine)) throw new Error("This machine does not support the selected CPU.");
    if (!bootTypes(vm).includes(vm.bootType)) throw new Error("ARM machines boot a kernel directly; select Linux kernel boot.");
    if (!Number.isInteger(vm.memory) || vm.memory < 16 || vm.memory > maxMemory(vm)) {
      throw new Error(`RAM must be a whole number between 16 and ${maxMemory(vm)} MiB for ${vm.architecture}. ${is64(vm) ? "" : "Select x86_64 or arm64 for up to 32768 MiB with a 64-bit guest."}`.trim());
    }
    if (!Number.isInteger(vm.cpu) || vm.cpu < 1 || vm.cpu > 8) throw new Error("Choose between 1 and 8 CPU cores.");
    if (!Number.isInteger(vm.vgaMemory) || vm.vgaMemory < 1 || vm.vgaMemory > 256) throw new Error("Video RAM must be between 1 and 256 MiB.");
    if (vm.network && !["auto", "none", "browser", "local"].includes(vm.network)) throw new Error("Choose a supported network mode.");
    if (vm.firmware === "uefi" && vm.architecture !== "x86_64") throw new Error("UEFI requires x86_64.");
    if (vm.fileRefs?.state?.runtime && vm.fileRefs.state.runtime !== "local-v64") throw new Error("This snapshot belongs to the previous v86 runtime. Download it, then remove it in v64 settings to boot with v64.");
    const saved = vm.fileRefs?.state?.machineConfig;
    if (saved && saved !== signature(vm)) throw new Error("The snapshot was saved with different hardware or media. Restore those settings or remove the snapshot in v64 settings.");
    return vm;
  }

  function signature(vm) {
    return JSON.stringify([vm.architecture, vm.machine, vm.firmware || "seabios", vm.memory, vm.cpu,
      vm.vgaMemory, vm.displayMode, vm.bootType, vm.network === "none" || !vm.network ? "none" : "virtio",
      ...["disk", "disk2", "cdrom", "floppy", "kernel", "initrd"].map(key => vm.fileRefs?.[key]?.id || null)]);
  }

  function diskFormat(ref) {
    const ext = String(ref?.name || "").toLowerCase().split(".").pop();
    return ["qcow2", "vhd", "vdi", "vmdk", "vhdx"].includes(ext) ? ext : "raw";
  }

  function options(vm, files = {}, resolve = path => path) {
    validate(vm);
    const arm = isARM(vm);
    const core = arm ? "v86-arm64" : "v86";
    const graphics = vm.displayMode === "serial" && arm ? "none" : arm ? "virtio_gpu" : "bochs_vga";
    const config = {
      cpu_type: vm.architecture,
      machine_type: vm.machine,
      cpu_cores: vm.cpu,
      experimental_smp_jit: vm.cpu > 1,
      cpu_worker: true,
      cpu_worker_url: resolve(base + "build/cpu-worker.js"),
      wasm_path: resolve(base + `build/${core}.wasm`),
      wasm_fallback_path: resolve(base + `build/${core}-fallback.wasm`),
      ...memoryOptions(vm),
      graphics_adapter: graphics,
      vram_size: vm.vgaMemory * MiB,
      autostart: true,
      disable_speaker: true,
      net_device: { type: "none" },
      preserve_mac_from_state_image: true
    };
    if (vm.network && vm.network !== "none") {
      const local = root.UTMRuntime.localRelayAvailable;
      if (vm.network === "local" && !local) throw new Error("Local internet needs the local server. Run: node scripts/serve-local.mjs");
      const useRelay = local && ["auto", "local"].includes(vm.network);
      config.net_device = {
        type: "virtio",
        relay_url: useRelay ? `${root.location.protocol === "https:" ? "wss" : "ws"}://${root.location.host}/net/` : "fetch"
      };
    }
    if (graphics !== "none") config.graphics_adapter_path = resolve(base + `build/v86-${graphics.replaceAll("_", "-")}.js`);
    if (arm) {
      config.virtio_rng = true;
      config.virtio_console = true;
      config.virtio_input = vm.displayMode !== "serial";
      if (files.kernel) config.kernel = files.kernel;
      if (files.disk) config.virtio_disks = [{ ...files.disk, format: diskFormat(vm.fileRefs.disk) }];
      if (files.disk2) {
        if (!files.disk) throw new Error("The first disk must be attached before the second disk.");
        config.virtio_disks.push({ ...files.disk2, format: diskFormat(vm.fileRefs.disk2) });
      }
    } else {
      config.audio_device = "none";
      config.acpi = vm.cpu > 1 || vm.architecture === "x86_64" || vm.machine === "q35";
      config.qemu_compatible = config.acpi;
      if (vm.firmware === "uefi") {
        config.firmware = { type: "uefi", code: { url: resolve(base + "bios/ovmf-code.fd") }, vars: { url: resolve(base + "bios/ovmf-vars.fd") } };
      } else {
        config.bios = { url: resolve(base + "bios/seabios.bin") };
        config.vga_bios = { url: resolve(base + "bios/vgabios.bin") };
      }
      config.boot_order = vm.bootType === "disk" ? 0x132 : vm.bootType === "floppy" ? 0x231 : 0x123;
      if (files.disk) config.hda = { ...files.disk, format: diskFormat(vm.fileRefs.disk) };
      if (files.disk2) config.hdb = { ...files.disk2, format: diskFormat(vm.fileRefs.disk2) };
      if (files.cdrom && vm.bootType === "iso") config.cdrom = files.cdrom;
      if (files.floppy && vm.bootType === "floppy") config.fda = files.floppy;
      if (files.kernel && vm.bootType === "kernel") config.bzimage = files.kernel;
    }
    if (files.initrd && vm.bootType === "kernel") config.initrd = files.initrd;
    if (vm.bootArguments) config.cmdline = vm.bootArguments;
    if (files.state) config.initial_state = files.state;
    return config;
  }

  root.UTMRuntime = { base, architectures, isARM, is64, maxMemory, bootTypes, machineTypes, normalize, validate, signature, diskFormat, options };
})(globalThis);
