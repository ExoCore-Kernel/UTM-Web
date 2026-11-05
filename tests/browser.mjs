const frame = document.querySelector("iframe");
const output = document.querySelector("#results");
const button = document.querySelector("button");
const log = text => { output.textContent += text + "\n"; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const assert = (condition, label) => { if (!condition) throw new Error(label); };

button.addEventListener("click", async () => {
  button.disabled = true;
  output.textContent = "";
  const app = frame.contentWindow;
  try {
    await until(() => typeof app.runVM === "function", "app loaded");
    for (const architecture of ["x86", "x86_64", "arm64", "arm32"]) {
      const arm = architecture.startsWith("arm");
      const fixture = `${architecture}.${arm ? "bin" : "img"}`;
      const bytes = await (await fetch(`fixtures/${fixture}`)).arrayBuffer();
      const file = new app.File([bytes], fixture);
      const role = arm ? "kernel" : "floppy";
      const ref = await app.importFileToStore(file, role);
      const vm = { name: `Verification ${architecture}`, runtime: "local-v64", architecture,
        machine: arm ? "virt" : "i440fx", firmware: "seabios", memory: 64, vgaMemory: 8,
        cpu: architecture === "x86_64" ? 2 : 1, displayMode: arm ? "serial" : "graphical",
        bootType: arm ? "kernel" : "floppy", fileRefs: { [role]: ref } };
      await app.importConfig({ files: [{ text: async () => JSON.stringify({ vm }) }] });
      const current = app.vmById();
      assert(current.name === vm.name, "Config import must select the new VM");
      app.runVM(current.id);
      await until(() => /UTM-.*-OK/.test(app.document.querySelector("#terminalOutput")?.textContent || "") ||
        /Stopped:/.test(app.document.querySelector("#terminalOutput")?.textContent || ""), `${architecture} guest boot`);
      const terminal = app.document.querySelector("#terminalOutput").textContent;
      assert(terminal.includes("-OK"), terminal);
      const screen = app.document.querySelector("#v86Screen");
      assert(!app.document.querySelector("#debugOutput"), "Diagnostics start hidden");
      if (!arm) {
        assert(app.getComputedStyle(app.document.querySelector("#terminalOutput")).display === "none", "GUI starts without serial/log overlay");
        const keyCodes = [];
        const bus = app.__utmWebRuntime.emulator.bus, send = bus.send;
        bus.send = (name, value) => { if (name === "keyboard-code") keyCodes.push(value); return send(name, value); };
        app.toggleGuestKeyboard();
        const keyboard = app.document.querySelector("#guiKeyboardInput");
        assert(app.document.activeElement === keyboard && !app.document.querySelector(".guest-keys"), "Device keyboard opens without a custom keyboard panel");
        keyboard.value = "a";
        keyboard.dispatchEvent(new app.InputEvent("input", { data: "a", inputType: "insertText" }));
        app.sendGuestKey("Backspace");
        bus.send = send;
        assert(keyCodes.includes(0x1e) && keyCodes.includes(0x9e) && keyCodes.includes(0x0e), `Touch typing and Backspace reach the real keyboard bus: ${keyCodes}`);
        app.toggleGuestKeyboard();
        const resize = app.document.querySelector("#guiResize"), panel = app.document.querySelector("#guiWindow");
        const oldWidth = panel.getBoundingClientRect().width;
        resize.dispatchEvent(new app.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        assert(panel.getBoundingClientRect().width < oldWidth, "Display can resize without restarting");
        app.resetGUIWindow();
        await app.toggleDisplayFullscreen();
        assert(app.document.querySelector("#app").classList.contains("display-fullscreen"), "Fullscreen fallback fills the viewport");
        assert(app.getComputedStyle(app.document.querySelector(".floating-toolbar")).display === "none", "Fullscreen hides app toolbar");
        const surface = app.document.querySelector("#displaySurface");
        const pointer = (type, id, x, y) => screen.dispatchEvent(new app.PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: id, clientX: x, clientY: y }));
        const center = panel.getBoundingClientRect();
        const cx = center.left + center.width / 2, cy = center.top + center.height / 2;
        pointer("pointerdown", 701, cx - 50, cy); pointer("pointerdown", 702, cx + 50, cy);
        pointer("pointermove", 701, cx - 100, cy); pointer("pointermove", 702, cx + 100, cy);
        assert(app.__utmWebRuntime.displayZoom > 1.9, "Two-finger pinch resizes in fullscreen");
        pointer("pointermove", 701, cx - 80, cy + 20); pointer("pointermove", 702, cx + 120, cy + 20);
        assert(Math.abs(app.__utmWebRuntime.panX) > 1 || Math.abs(app.__utmWebRuntime.panY) > 1, "Two-finger drag moves the fullscreen window");
        pointer("pointerup", 702, cx + 120, cy + 20); pointer("pointerup", 701, cx - 80, cy + 20);
        app.resetGUIWindow();
        assert(app.__utmWebRuntime.displayZoom === 1 && app.__utmWebRuntime.panX === 0, "Fit resets fullscreen zoom and position");

        await app.toggleDisplayFullscreen();
        assert(screen === app.document.querySelector("#v86Screen"), "Keyboard/resize/fullscreen preserve the emulator display");
      }
      assert(app.__utmWebRuntime.emulator.worker_controller, "The guest CPU must run in a worker");
      app.toggleDebugPanel();
      app.toggleDebugPanel();
      assert(screen === app.document.querySelector("#v86Screen"), "Debug toggle must preserve the emulator display");
      if (!arm) {
        app.sendSerialOnly("INPUT-OK\n");
        await until(() => app.document.querySelector("#terminalOutput").textContent.includes("INPUT-OK"), "serial input reaches guest");
      }
      await app.saveActiveDisk();
      assert(current.fileRefs.state?.runtime === "local-v64", "Snapshot must persist in IndexedDB");
      await app.stopDisplay();
      app.runVM(current.id);
      await until(() => app.__utmWebRuntime?.status === "running" ||
        app.document.querySelector("#terminalOutput")?.textContent.includes("Stopped:"), "snapshot restore");
      assert(app.__utmWebRuntime.status === "running", app.document.querySelector("#terminalOutput").textContent);
      if (!arm) {
        app.sendSerialOnly("RESTORE-OK\n");
        await until(() => app.document.querySelector("#terminalOutput").textContent.includes("RESTORE-OK"), "restored guest executes");
      }
      await app.stopDisplay();
      log(`PASS ${architecture}: guest code executed, worker, display retained, snapshot saved/restored${arm ? "" : ", serial input"}.`);
    }
    if (app.UTMStorage.supportsOPFS()) {
      const image = await (await fetch("fixtures/disk.img")).blob();
      const ref = await app.importFileToStore(new app.File([image], "persistence.img"), "disk");
      assert(ref.storage === "opfs", "RAW disks must use OPFS");
      const vm = { name: "Verification persistent disk", runtime: "local-v64", architecture: "x86", memory: 64, vgaMemory: 8, cpu: 1,
        displayMode: "serial", bootType: "disk", saveOnStop: false, fileRefs: { disk: ref } };
      await app.importConfig({ files: [{ text: async () => JSON.stringify({ vm }) }] });
      const current = app.vmById();
      for (const marker of ["WRITTEN", "PERSISTED"]) {
        app.runVM(current.id);
        await until(() => app.document.querySelector("#terminalOutput")?.textContent.includes(`UTM-DISK-${marker}-OK`), `OPFS disk ${marker}`);
        if (marker === "PERSISTED") {
          const originalWrite = app.UTMStorage.write;
          const originalDownload = app.downloadTarget;
          try {
            app.UTMStorage.write = async () => { throw new app.DOMException("Test storage quota", "QuotaExceededError"); };
            assert(await app.saveActiveDisk() === false, "Quota failure must be reported");
            assert(app.__utmWebRuntime.status === "running", "Storage failure must leave VM running");
            assert(app.document.querySelector("#actionSheet").textContent.includes("Download VM Snapshot"), "Offer download fallback");
            let downloaded = 0;
            app.downloadTarget = async () => ({ write: chunk => { downloaded += chunk.length; }, finish: async () => {}, abort: async () => {} });
            await app.downloadSnapshot();
            assert(downloaded > 0, "Fallback must stream a real snapshot without browser storage");
            log("PASS storage-full failure preserves VM and streams a downloadable snapshot.");
          } finally { app.UTMStorage.write = originalWrite; app.downloadTarget = originalDownload; app.hideSheet(); }
          await app.saveRunningDisk();
          const copy = await app.storedFile(current.fileRefs.diskExport);
          assert(new DataView(await copy.slice(0, 4).arrayBuffer()).getUint32(0) === 0x514649fb, "Disk export is real QCOW2");
          assert(current.fileRefs.disk.id === ref.id, "Export must preserve the live base disk");
        }
        await app.stopDisplay();
      }
      const file = await app.storedFile(ref);
      assert(new Uint8Array(await file.slice(512, 513).arrayBuffer())[0] === 0x41, "Guest disk writes must persist outside the runtime");
      log("PASS RAW disk writes survive a cold boot without a snapshot; QCOW2 export includes the current disk.");
      const originalEstimate = app.UTMStorage.estimate;
      try {
        app.UTMStorage.estimate = async () => ({ quota: 1, usage: 0 });
        const temporary = await app.importFileToStore(new app.File(["too big"], "temporary.iso"), "cdrom");
        assert(temporary.storage === "temporary", "Oversize media must support this-tab-only operation");
        assert((await app.storedFile(temporary)).size === 7, "Transient media is readable");
        log("PASS media exceeding storage quota remains usable for the current tab.");
      } finally { app.UTMStorage.estimate = originalEstimate; app.hideSheet(); }
    } else log("SKIP writable-disk checks: this browser has no OPFS.");
    // Save and reload the original default VM, which the old migration discarded.
    // Compact a real boot disk, run it through v64 and expand it again.
    {
      const raw = await (await fetch("fixtures/disk.img")).blob();
      const ref = await app.importFileToStore(new app.File([raw], "sparse-test.img"), "disk");
      await app.importConfig({ files: [{ text: async () => JSON.stringify({ vm: { name: "Verification sparse disk", runtime: "local-v64", architecture: "x86", memory: 64, cpu: 1, vgaMemory: 8, network: "none", displayMode: "serial", bootType: "disk", fileRefs: { disk: ref } } }) }] });
      const current = app.vmById();
      await app.compactStoredDisk(current.id);
      app.hideSheet();
      assert(current.fileRefs.disk.name.endsWith(".qcow2"), "Compaction attaches QCOW2");
      assert(current.fileRefs.disk.size < ref.size, "Compaction actually frees space");
      assert(current.fileRefs.disk.virtualSize === raw.size, "Compaction preserves capacity");
      app.runVM(current.id);
      await until(() => app.document.querySelector("#terminalOutput")?.textContent.includes("UTM-DISK-WRITTEN-OK"), "compacted disk boots and accepts writes");
      const expanded = [];
      await app.__utmWebRuntime.emulator.export_disk_image("hda", { format: "raw", write: chunk => expanded.push(chunk.slice()) });
      const bytes = new Uint8Array(await new Blob(expanded).arrayBuffer());
      assert(bytes.length === raw.size && bytes[512] === 0x41 && bytes[510] === 0x55 && bytes[511] === 0xaa, "Expanded RAW retains guest writes and boot signature");
      await app.stopDisplay();
      assert(current.fileRefs.state, "Sparse disk writes save in a snapshot");
      app.runVM(current.id);
      await until(() => app.__utmWebRuntime?.status === "running", "sparse disk snapshot restore");
      const restored = [];
      await app.__utmWebRuntime.emulator.export_disk_image("hda", { format: "raw", write: chunk => restored.push(chunk.slice()) });
      assert(new Uint8Array(await new Blob(restored).arrayBuffer())[512] === 0x41, "Restored sparse disk retains guest writes");
      await app.stopDisplay();
      log("PASS sparse disk compaction: boots, accepts writes, expands to RAW and restores writes from a snapshot.");
    }
    // A blank 20 GiB disk must fit in tiny storage and expose 20 GiB to v64.
    {
      const file = new app.File([await (await fetch("fixtures/x86.img")).blob()], "probe.img");
      const floppy = await app.importFileToStore(file, "floppy");
      await app.importConfig({ files: [{ text: async () => JSON.stringify({ vm: { name: "Verification 20 GiB disk", architecture: "x86", memory: 64, cpu: 1, vgaMemory: 8, network: "none", displayMode: "graphical", bootType: "floppy", fileRefs: { floppy } } }) }] });
      app.editVM(app.vmById().id);
      app.setDraft("storage", 20);
      await app.createBlankDisk("draft");
      await app.saveSettings();
      const current = app.vmById();
      assert(current.fileRefs.disk.virtualSize === 20 * 1024 ** 3 && current.fileRefs.disk.size === 262144, "20 GiB blank disk uses 256 KiB of metadata");
      app.runVM(current.id);
      await until(() => app.__utmWebRuntime?.status === "running", "large sparse disk attached");
      const info = await app.__utmWebRuntime.emulator.disk_image_info("hda");
      assert(info.size === 20 * 1024 ** 3 && info.format === "qcow2", "v64 sees the full virtual disk capacity");
      await app.stopDisplay();
      log("PASS 20 GiB blank disk stores 256 KiB and exposes full capacity to v64.");
    }
    const stored = JSON.parse(app.localStorage.getItem("utm-web-state"));
    const original = stored.vms.find(vm => vm.id === "custom-pc");
    if (original) {
      original.notes = "Persistence verification";
      app.localStorage.setItem("utm-web-state", JSON.stringify(stored));
      app.location.reload();
      await pause(500);
      await until(() => typeof frame.contentWindow.vmById === "function", "reloaded app");
      assert(frame.contentWindow.vmById("custom-pc").notes === "Persistence verification", "Default VM edits survive reload");
      log("PASS default VM changes survive reload.");
    }
    log("ALL CHECKS PASSED");
  } catch (error) {
    log(`FAIL ${error.stack || error}`);
  } finally {
    button.disabled = false;
  }
});
