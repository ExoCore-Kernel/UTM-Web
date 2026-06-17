/*
  UTM Web functional browser prototype.
  UI references:
  - UTM-main/Platform/iOS/VMWizardView.swift
  - UTM-main/Platform/iOS/VMSettingsView.swift
  - UTM-main/Platform/iOS/VMToolbarView.swift
  Runtime references:
  - UTM-main/Configuration/QEMUArgumentBuilder.swift
  - UTM-main/Configuration/UTMQemuConfiguration+Arguments.swift
  - https://github.com/ktock/qemu-wasm-demo
  - https://github.com/ktock/qemu-wasm-sample
*/

const assets = {
  utm: "assets/utm-icon.png",
  linux: "assets/logo-linux.png",
  alpine: "assets/Icons/alpine.png"
};

const qemuWasm = {
  root: "external/qemu-wasm-demo/docs/images/alpine-x86_64/",
  module: "external/qemu-wasm-demo/docs/images/alpine-x86_64/out.js",
  docs: "external/qemu-wasm-demo/README.md",
  upstream: "https://github.com/ktock/qemu-wasm-demo",
  packageLoaders: {
    rom: "external/qemu-wasm-demo/docs/images/alpine-x86_64/load-rom.js",
    kernel: "external/qemu-wasm-demo/docs/images/alpine-x86_64/load-kernel.js",
    initramfs: "external/qemu-wasm-demo/docs/images/alpine-x86_64/load-initramfs.js",
    rootfs: "external/qemu-wasm-demo/docs/images/alpine-x86_64/load-rootfs.js"
  }
};

const supportedMachines = [
  { title: "Intel ICH9 based PC (Q35, x86_64)", arch: "x86_64", target: "q35", memory: 512, storage: 1, cpu: 1 },
  { title: "Intel i440FX based PC (PC, x86_64)", arch: "x86_64", target: "pc", memory: 512, storage: 1, cpu: 1 }
];

const storageDbName = "utm-web-storage";
const storageStoreName = "files";

const defaults = {
  route: { name: "library" },
  selectedId: "alpine-demo",
  editingId: null,
  draft: null,
  wizard: null,
  actionSheet: null,
  vms: [
    {
      id: "alpine-demo",
      name: "Alpine Linux",
      os: "Linux",
      status: "Ready",
      icon: assets.alpine,
      notes: "A local QEMU-WASM VM backed by the qemu-wasm-demo submodule in this repository. It boots the packaged Alpine kernel, initramfs, and rootfs without redirecting to another site.",
      runtime: "local-qemu-wasm",
      architecture: "x86_64",
      machine: "pc",
      memory: 512,
      cpu: 1,
      storage: 1,
      displayMode: "serial",
      bootType: "packaged-demo",
      bootArguments: "console=ttyS0 root=/dev/vda noautodetect hostname=demo",
      fileRefs: {},
      qemuArgs: [],
      network: "none"
    },
    {
      id: "linux-custom",
      name: "Custom Linux",
      os: "Linux",
      status: "Stopped",
      icon: assets.linux,
      notes: "A local QEMU-WASM configuration. Import an ISO, kernel, or disk image into browser storage and boot it with the vendored QEMU-WASM submodule.",
      runtime: "local-qemu-wasm",
      architecture: "x86_64",
      machine: "q35",
      memory: 512,
      cpu: 1,
      storage: 2,
      displayMode: "serial",
      bootType: "iso",
      bootArguments: "console=ttyS0 root=/dev/vda rw",
      fileRefs: {},
      qemuArgs: [],
      network: "none"
    }
  ]
};

let state = loadState();
let transientFiles = new Map();
let runtimeSession = null;
const terminalDecoder = new TextDecoder();
const terminalEncoder = new TextEncoder();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("utm-web-state") || "null");
    if (saved && Array.isArray(saved.vms)) {
      const defaultIds = new Set(defaults.vms.map(vm => vm.id));
      const migrated = saved.vms
        .map(migrateVM)
        .filter(Boolean)
        .filter(vm => !defaultIds.has(vm.id));
      const vms = [...structuredClone(defaults.vms), ...migrated];
      const selectedId = vms.some(vm => vm.id === saved.selectedId) ? saved.selectedId : defaults.selectedId;
      return {
        ...structuredClone(defaults),
        selectedId,
        vms,
        route: { name: "library" },
        actionSheet: null,
        wizard: null,
        draft: null
      };
    }
  } catch (error) {
    console.warn(error);
  }
  return structuredClone(defaults);
}

function migrateVM(vm) {
  if (!vm || typeof vm !== "object") return null;
  if (vm.runtime && vm.runtime !== "local-qemu-wasm") return structuredClone(defaults.vms[0]);
  if (vm.runtime === "local-qemu-wasm") {
    const migrated = {
      ...structuredClone(defaults.vms[1]),
      ...vm,
      os: "Linux",
      runtime: "local-qemu-wasm",
      status: vm.bootType === "packaged-demo" ? "Ready" : "Stopped",
      displayMode: vm.displayMode === "graphical" ? "graphical" : "serial",
      fileRefs: vm.fileRefs || {}
    };
    if (/runtime files|hosted demo|demo site/i.test(migrated.notes || "")) {
      migrated.notes = vm.id === defaults.vms[1].id
        ? defaults.vms[1].notes
        : "Local browser VM config generated from UTM-Web. Import boot media into browser storage, then run it with the vendored QEMU-WASM engine.";
    }
    return migrated;
  }
  if (vm.os === "Linux" || ["x86_64", "i386"].includes(vm.architecture)) {
    return {
      ...structuredClone(defaults.vms[1]),
      id: vm.id || `vm-${Date.now()}`,
      name: vm.name || "Linux",
      notes: vm.notes || "Migrated from an older UTM-Web mock VM into a local QEMU-WASM launch config.",
      architecture: ["x86_64", "i386"].includes(vm.architecture) ? vm.architecture : "x86_64",
      machine: vm.machine === "pc" || vm.machine === "q35" ? vm.machine : "q35",
      memory: Number(vm.memory || 512),
      cpu: Math.max(1, Number(vm.cpu || 1)),
      storage: Number(vm.storage || 2),
      displayMode: vm.displayMode === "graphical" ? "graphical" : "serial",
      bootArguments: vm.bootArguments || "console=ttyS0 root=/dev/vda rw",
      fileRefs: {},
      status: "Stopped"
    };
  }
  return null;
}

function saveState() {
  localStorage.setItem("utm-web-state", JSON.stringify({
    selectedId: state.selectedId,
    vms: state.vms
  }));
}

function storageId(prefix = "file") {
  const random = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}

function openStorageDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(storageDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storageStoreName)) {
        db.createObjectStore(storageStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withFileStore(mode, callback) {
  const db = await openStorageDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storageStoreName, mode);
      const store = tx.objectStore(storageStoreName);
      const value = callback(store);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function putRecord(record) {
  await withFileStore("readwrite", store => store.put(record));
}

async function getRecord(id) {
  return withFileStore("readonly", store => new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

async function importFileToStore(file, role) {
  const record = {
    id: storageId(role),
    role,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
    savedAt: Date.now(),
    blob: file
  };
  await putRecord(record);
  return fileMeta(record);
}

async function readStoredBytes(ref, transientKey) {
  const transient = transientFiles.get(transientKey || ref?.id);
  if (transient) {
    return new Uint8Array(await transient.arrayBuffer());
  }
  if (!ref?.id) return null;
  const record = await getRecord(ref.id);
  if (!record?.blob) return null;
  return new Uint8Array(await record.blob.arrayBuffer());
}

async function updateStoredBytes(ref, bytes) {
  if (!ref?.id) {
    throw new Error("No persistent disk reference is attached to this VM.");
  }
  const existing = await getRecord(ref.id);
  if (!existing) {
    throw new Error("The saved disk record is missing from browser storage.");
  }
  const blob = new Blob([bytes], { type: existing.type || "application/octet-stream" });
  const record = {
    ...existing,
    size: blob.size,
    savedAt: Date.now(),
    blob
  };
  await putRecord(record);
  return fileMeta(record);
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function vmById(id = state.selectedId) {
  return state.vms.find(vm => vm.id === id) || state.vms[0];
}

function setRoute(route) {
  state.route = route;
  state.actionSheet = null;
  render();
}

function navButton(label, action, extra = "") {
  return `<button class="nav-button ${extra}" onclick="${action}">${label}</button>`;
}

function renderNav(title, left = "", right = "") {
  $("nav").innerHTML = `
    <div class="nav-side left">${left}</div>
    <div class="nav-title">${escapeHtml(title)}</div>
    <div class="nav-side right">${right}</div>
  `;
}

function render() {
  const app = $("app");
  $("view").className = "view";
  app.classList.toggle("display-mode", state.route.name === "display");
  if (state.route.name === "library") renderLibrary();
  if (state.route.name === "detail") renderDetail();
  if (state.route.name === "wizard") renderWizard();
  if (state.route.name === "settings") renderSettingsRoot();
  if (state.route.name === "settingsPane") renderSettingsPane();
  if (state.route.name === "display") renderDisplay();
  renderActionSheet();
}

function row(title, value = "", attrs = "") {
  return `
    <div class="row" ${attrs}>
      <span class="row-title">${escapeHtml(title)}</span>
      <span class="row-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function navRow(title, icon, color, action, value = "") {
  return `
    <button class="nav-row" onclick="${action}">
      ${iconMarkup(icon, color)}
      <span class="row-title">${escapeHtml(title)}</span>
      <span class="row-value">${escapeHtml(value)}</span>
      <span class="chevron">&rsaquo;</span>
    </button>
  `;
}

function iconMarkup(icon, color = "icon-gray") {
  if (String(icon).startsWith("sf:")) {
    return `<span class="round-icon ${color}">${symbolSvg(String(icon).slice(3))}</span>`;
  }
  if (String(icon).includes("/") || String(icon).includes(".")) {
    return `<img class="row-image" src="${escapeHtml(icon)}" alt="">`;
  }
  return `<span class="round-icon ${color}">${escapeHtml(icon)}</span>`;
}

function symbolSvg(name) {
  const icons = {
    "plus.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>`,
    "terminal": `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m8 10 3 2-3 2M13 15h3"/></svg>`,
    "info.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.1"/></svg>`,
    "cpu": `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/></svg>`,
    "externaldrive": `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="14" rx="2"/><path d="M9 15h6M12 8v3"/></svg>`,
    "shippingbox": `<svg viewBox="0 0 24 24"><path d="M5 8.5 12 5l7 3.5v7L12 19l-7-3.5z"/><path d="M5 8.5 12 12l7-3.5M12 12v7"/></svg>`,
    "doc": `<svg viewBox="0 0 24 24"><path d="M7 4.5h6l4 4V19H7z"/><path d="M13 4.5v4h4"/></svg>`,
    "square.and.arrow.down": `<svg viewBox="0 0 24 24"><path d="M12 4v9M8.5 9.5 12 13l3.5-3.5"/><path d="M6 13v5h12v-5"/></svg>`,
    "doc.on.clipboard": `<svg viewBox="0 0 24 24"><path d="M9 5h6l1 2h2v13H6V7h2z"/><path d="M9 10h6M9 13h6M9 16h4"/></svg>`,
    "trash": `<svg viewBox="0 0 24 24"><path d="M7 8h10M10 8V6h4v2M9 10v7M12 10v7M15 10v7M8 8l1 12h6l1-12"/></svg>`,
    "gearshape": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3.8v2.1M12 18.1v2.1M4.9 7.9l1.8 1M17.3 15.1l1.8 1M4.9 16.1l1.8-1M17.3 8.9l1.8-1M3.8 12h2.1M18.1 12h2.1"/></svg>`,
    "rectangle.on.rectangle": `<svg viewBox="0 0 24 24"><rect x="5" y="7" width="11" height="8" rx="1.5"/><path d="M8 17h11V9"/></svg>`,
    "network.slash": `<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M12 8v3.5M12 11.5 7 15M12 11.5 17 15M5 5l14 14"/></svg>`
  };
  return icons[name] || icons.gearshape;
}

function toggleRow(title, checked, onChange) {
  return `
    <label class="row">
      <span class="row-title">${escapeHtml(title)}</span>
      <span class="toggle">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="${onChange}">
        <span></span>
      </span>
    </label>
  `;
}

function textInputRow(title, value, onInput, type = "text") {
  return `
    <label class="row">
      <span class="row-title">${escapeHtml(title)}</span>
      <input type="${type}" value="${escapeHtml(value)}" oninput="${onInput}">
    </label>
  `;
}

function selectRow(title, value, options, onChange) {
  return `
    <label class="row">
      <span class="row-title">${escapeHtml(title)}</span>
      <select onchange="${onChange}">
        ${options.map(option => `<option ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function fileRow(title, key, scope = "wizard") {
  const target = scope === "draft" ? state.draft : state.wizard;
  const file = target.fileRefs?.[key];
  const action = scope === "draft" ? `pickDraftFile('${key}', this)` : `pickWizardFile('${key}', this)`;
  return `
    <label class="row">
      <span class="row-title">${escapeHtml(title)}</span>
      <input class="media-file" type="file" accept="${escapeHtml(fileAccept(key))}" onchange="${action}">
      <button class="file-button" type="button" onclick="this.previousElementSibling.click()">
        <span class="row-value">${escapeHtml(file ? file.name : "Choose...")}</span>
        <span class="chevron">&rsaquo;</span>
      </button>
    </label>
  `;
}

function codeBlock(text) {
  return `<pre class="code-block"><code>${escapeHtml(text)}</code></pre>`;
}

function fileAccept(key) {
  return {
    kernel: ".bin,.elf,.img,vmlinuz",
    initrd: ".img,.initrd,.gz",
    disk: ".qcow2,.qcow,.vmdk,.raw,.img",
    cdrom: ".iso,.img"
  }[key] || "";
}

function renderLibrary() {
  $("view").className = "view library-view";
  renderNav("UTM", navButton("+", "openWizard()", "strong"), navButton("Runtime", "showRuntimeSheet()"));
  const list = `
    <div class="library-list">
      <h1 class="large-title">UTM</h1>
      <section class="section">
        <div class="group">
          ${state.vms.map(vm => `
            <div class="vm-row ${vm.id === state.selectedId ? "selected" : ""}" role="button" tabindex="0" onclick="libraryTap('${vm.id}')">
              <img src="${escapeHtml(vm.icon)}" alt="">
              <span class="vm-meta">
                <span class="vm-name">${escapeHtml(vm.name)}</span>
                <span class="vm-subtitle">${escapeHtml(vm.status)}</span>
              </span>
              <button class="play-button" onclick="event.stopPropagation(); runVM('${vm.id}')">&#9654;</button>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="section">
        <div class="group">
          ${navRow("Create Linux VM", "sf:plus.circle", "icon-blue", "openWizard()")}
          ${navRow("Import UTM-Web Config", "sf:doc", "icon-gray", "showImportConfigSheet()")}
        </div>
      </section>
    </div>
  `;
  $("view").innerHTML = `
    <div class="library-shell">
      ${list}
      <div class="ipad-detail-panel">${renderDetailBody(vmById(state.selectedId), true)}</div>
    </div>
  `;
}

function isIpadLayout() {
  return window.matchMedia("(min-width: 760px)").matches;
}

function libraryTap(id) {
  state.selectedId = id;
  if (isIpadLayout()) {
    renderLibrary();
  } else {
    setRoute({ name: "detail", id });
  }
}

function runVM(id = state.selectedId) {
  const vm = vmById(id);
  state.selectedId = vm.id;
  vm.status = "Starting";
  saveState();
  runtimeSession = {
    vmId: vm.id,
    status: "starting",
    mode: vm.runtime,
    displayMode: vm.displayMode || "serial",
    output: [],
    module: null,
    diskPath: "/utm/disk.img",
    diskRef: null,
    startedAt: Date.now()
  };
  setRoute({ name: "display", id: vm.id });
  queueMicrotask(() => startRuntime(vm.id));
}

function renderDetail() {
  const vm = vmById(state.route.id);
  renderNav(
    vm.name,
    navButton("&lsaquo; UTM", "setRoute({ name: 'library' })"),
    `${navButton("Settings", "openSettings()")} ${navButton("Run", "runVM()")}`
  );
  $("view").innerHTML = renderDetailBody(vm);
}

function renderDetailBody(vm) {
  const plan = buildQemuPlan(vm);
  const missing = requiredFileKeys(vm).filter(key => !vm.fileRefs?.[key]);
  return `
    <section class="runtime-preview">
      <img src="${escapeHtml(vm.icon)}" alt="">
      <div>
        <h2>${escapeHtml(vm.name)}</h2>
        <p>${escapeHtml(vm.status)}</p>
      </div>
      <button class="big-play" onclick="runVM('${vm.id}')">&#9654;</button>
    </section>
    <section class="section">
      <div class="group">
        ${row("Runtime", runtimeLabel(vm))}
        ${row("Architecture", vm.architecture)}
        ${row("Machine", vm.machine)}
        ${row("Memory", `${vm.memory} MiB`)}
        ${row("Display", displayLabel(vm))}
        ${row("Boot", bootLabel(vm))}
        ${row("Network", networkLabel(vm))}
      </div>
    </section>
    ${missing.length ? `
      <section class="section">
        <p class="section-title">Required Files</p>
        <div class="group">${missing.map(key => row(fileTitle(key), "Missing")).join("")}</div>
      </section>
    ` : ""}
    ${Object.keys(vm.fileRefs || {}).length ? `
      <section class="section">
        <p class="section-title">Attached Media</p>
        <div class="group">
          ${Object.entries(vm.fileRefs).map(([key, file]) => row(fileTitle(key), `${file.name} · ${formatBytes(file.size)}`)).join("")}
          ${vm.fileRefs?.disk ? navRow("Download Disk Image", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'disk')`) : ""}
        </div>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">QEMU</p>
      <div class="group">
        ${navRow("Copy Arguments", "sf:doc.on.clipboard", "icon-blue", `copyQemuArgs('${vm.id}')`)}
        ${navRow("Export Config", "sf:square.and.arrow.down", "icon-green", `exportConfig('${vm.id}')`)}
      </div>
      ${codeBlock(`${plan.executable} ${shellQuoteArgs(plan.args)}`)}
    </section>
    <section class="section">
      <p class="section-title">Notes</p>
      <div class="group"><p class="detail-notes">${escapeHtml(vm.notes)}</p></div>
    </section>
  `;
}

function runtimeLabel(vm) {
  return "Local QEMU-WASM";
}

function networkLabel(vm) {
  return "None";
}

function displayLabel(vm) {
  return vm.displayMode === "graphical" ? "Graphical display" : "Serial console";
}

function bootLabel(vm) {
  if (vm.bootType === "packaged-demo") return "Packaged Alpine image";
  if (vm.bootType === "kernel") return "Linux kernel + disk";
  if (vm.bootType === "iso") return "Boot ISO image";
  return "Disk image";
}

function requiredFileKeys(vm) {
  if (vm.bootType === "packaged-demo") return [];
  if (vm.bootType === "kernel") return ["kernel", "disk"];
  if (vm.bootType === "iso") return ["cdrom"];
  return ["disk"];
}

function fileTitle(key) {
  return {
    kernel: "Kernel",
    initrd: "Initial Ramdisk",
    disk: "Disk Image",
    cdrom: "CD/DVD Image"
  }[key] || key;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function diskFormat(ref) {
  const name = String(ref?.name || "").toLowerCase();
  if (name.endsWith(".qcow2") || name.endsWith(".qcow")) return "qcow2";
  if (name.endsWith(".vmdk")) return "vmdk";
  return "raw";
}

function openWizard() {
  state.wizard = newWizard();
  setRoute({ name: "wizard", page: "start" });
}

function newWizard() {
  return {
    history: [],
    page: "start",
    runtime: "local-qemu-wasm",
    machineIndex: 0,
    architecture: "x86_64",
    target: "q35",
    memory: 512,
    cpu: 1,
    storage: 2,
    displayMode: "serial",
    bootType: "iso",
    bootArguments: "console=ttyS0 root=/dev/vda rw",
    name: "",
    fileRefs: {}
  };
}

function wizardTitle(page = state.route.page) {
  return {
    start: "Start",
    boot: "Boot",
    hardware: "Hardware",
    storage: "Storage",
    summary: "Summary"
  }[page] || "Start";
}

function renderWizard() {
  const page = state.route.page;
  state.wizard.page = page;
  const left = page === "start"
    ? navButton("Cancel", "cancelWizard()")
    : navButton("&lsaquo; Back", "wizardBack()");
  const right = page === "summary"
    ? navButton("Save", "saveWizard()", "strong")
    : navButton("Continue", "wizardContinue()", "strong");
  renderNav(wizardTitle(page), left, right);
  $("view").innerHTML = renderWizardPage(page);
}

function renderWizardPage(page) {
  if (page === "start") return wizardStart();
  if (page === "boot") return wizardBoot();
  if (page === "hardware") return wizardHardware();
  if (page === "storage") return wizardStorage();
  if (page === "summary") return wizardSummary();
  return "";
}

function wizardStart() {
  return `
    <section class="section">
      <p class="section-title">Custom</p>
      <div class="group">
        <button class="choice-row" onclick="wizardContinue()">
          ${iconMarkup(assets.linux)}
          <span class="choice-copy"><strong>Linux</strong><span>QEMU-WASM system emulation in the browser.</span></span>
          <span class="checkmark">&#10003;</span>
        </button>
      </div>
    </section>
    <section class="section">
      <p class="section-title">Runtime</p>
      <div class="group">
        ${row("Engine", "QEMU-WASM")}
        ${row("Display", "Serial console")}
        ${row("Acceleration", "TCG")}
        ${row("Network", "Off")}
      </div>
    </section>
  `;
}

function wizardBoot() {
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Boot Type", state.wizard.bootType, ["iso", "kernel", "disk"], "setWizardValue('bootType', this.value)")}
      </div>
    </section>
    ${state.wizard.bootType === "iso" ? `
      <section class="section">
        <p class="section-title">CD/DVD</p>
        <div class="group">${fileRow("Boot ISO Image", "cdrom")}</div>
      </section>
    ` : ""}
    ${state.wizard.bootType === "kernel" ? `
      <section class="section">
        <p class="section-title">Linux Kernel</p>
        <div class="group">
          ${fileRow("Kernel", "kernel")}
          ${fileRow("Initial Ramdisk", "initrd")}
        </div>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">${state.wizard.bootType === "iso" ? "Writable Disk" : "Storage"}</p>
      <div class="group">${fileRow("Disk Image", "disk")}</div>
      ${state.wizard.bootType === "iso" ? `<p class="section-footer">Optional, but needed if you want the guest to install or save changes to a disk image.</p>` : ""}
    </section>
    <section class="section">
      <p class="section-title">Boot Arguments</p>
      <div class="group">${textInputRow("Append", state.wizard.bootArguments, "setWizardSilent('bootArguments', this.value)")}</div>
    </section>
  `;
}

function wizardHardware() {
  const selected = supportedMachines[state.wizard.machineIndex] || supportedMachines[0];
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Machine", selected.title, supportedMachines.map(machine => machine.title), "chooseMachine(this.selectedIndex)")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Display</p>
      <div class="group">
        ${selectRow("Mode", state.wizard.displayMode, ["serial", "graphical"], "setWizardValue('displayMode', this.value)")}
      </div>
      ${state.wizard.displayMode === "graphical" ? `<p class="section-footer">Graphical mode uses the browser canvas and pointer input. The included upstream x86_64 build is serial-first, so custom graphical guests need a canvas-enabled QEMU-WASM build.</p>` : ""}
    </section>
    <section class="section">
      <p class="section-title">Memory</p>
      <div class="group">
        <div class="row">
          <span class="row-title">RAM</span>
          <span class="range-row">
            <input type="range" min="128" max="2048" step="128" value="${state.wizard.memory}" oninput="setWizardSilent('memory', Number(this.value)); this.nextElementSibling.value = this.value">
            <input type="number" value="${state.wizard.memory}" oninput="setWizardSilent('memory', Number(this.value))">
          </span>
        </div>
      </div>
    </section>
    <section class="section">
      <p class="section-title">CPU</p>
      <div class="group">
        <div class="row">
          <span class="row-title">CPU Cores</span>
          <span class="stepper">
            <button onclick="stepWizard('cpu', -1)">-</button>
            <span>${state.wizard.cpu}</span>
            <button onclick="stepWizard('cpu', 1)">+</button>
          </span>
        </div>
      </div>
    </section>
  `;
}

function wizardStorage() {
  return `
    <section class="section">
      <p class="section-title">Size</p>
      <div class="group">
        <div class="row">
          <span class="row-title">Expected Disk Size</span>
          <input type="number" min="1" value="${state.wizard.storage}" oninput="setWizardSilent('storage', Number(this.value))">
          <span class="row-value">GiB</span>
        </div>
      </div>
      <p class="section-footer">The browser cannot create sparse VM disks yet. This size is saved in the config and reflected in the launch plan.</p>
    </section>
  `;
}

function wizardSummary() {
  const name = state.wizard.name || defaultName();
  const preview = wizardToVM("preview");
  const plan = buildQemuPlan(preview);
  return `
    <section class="section">
      <p class="section-title">Information</p>
      <div class="group">${textInputRow("Name", name, "setWizardSilent('name', this.value)")}</div>
    </section>
    <section class="section">
      <p class="section-title">System</p>
      <div class="group">
        ${row("Engine", "QEMU-WASM")}
        ${row("Architecture", preview.architecture)}
        ${row("Machine", preview.machine)}
        ${row("Display", displayLabel(preview))}
        ${row("RAM", `${preview.memory} MiB`)}
        ${row("CPU", `${preview.cpu} Core${preview.cpu === 1 ? "" : "s"}`)}
        ${row("Storage", `${preview.storage} GiB`)}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Boot</p>
      <div class="group">
        ${row("Type", bootLabel(preview))}
        ${Object.entries(preview.fileRefs).map(([key, file]) => row(fileTitle(key), file.name)).join("")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">QEMU</p>
      ${codeBlock(`${plan.executable} ${shellQuoteArgs(plan.args)}`)}
    </section>
  `;
}

function chooseMachine(index) {
  const machine = supportedMachines[Number(index)] || supportedMachines[0];
  state.wizard.machineIndex = Number(index);
  state.wizard.architecture = machine.arch;
  state.wizard.target = machine.target;
  state.wizard.memory = machine.memory;
  state.wizard.cpu = machine.cpu;
  state.wizard.storage = machine.storage;
  render();
}

function setWizardValue(key, value) {
  state.wizard[key] = value;
  render();
}

function setWizardSilent(key, value) {
  state.wizard[key] = value;
}

function stepWizard(key, delta) {
  state.wizard[key] = Math.max(1, Math.min(8, Number(state.wizard[key] || 1) + delta));
  render();
}

async function pickWizardFile(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  state.wizard.fileRefs[key] = await importFileToStore(file, key);
  transientFiles.set(`wizard:${key}`, file);
  render();
}

function wizardNextPage(page = state.route.page) {
  if (page === "start") return "boot";
  if (page === "boot") return "hardware";
  if (page === "hardware") return "storage";
  if (page === "storage") return "summary";
  return "summary";
}

function wizardContinue() {
  const current = state.route.page;
  state.wizard.history.push(current);
  setRoute({ name: "wizard", page: wizardNextPage(current) });
}

function wizardBack() {
  const previous = state.wizard.history.pop() || "start";
  setRoute({ name: "wizard", page: previous });
}

function cancelWizard() {
  state.wizard = null;
  setRoute({ name: "library" });
}

function saveWizard() {
  const vm = wizardToVM(`vm-${Date.now()}`);
  for (const key of Object.keys(vm.fileRefs)) {
    const file = transientFiles.get(`wizard:${key}`);
    if (file) transientFiles.set(`${vm.id}:${key}`, file);
  }
  state.vms.push(vm);
  state.selectedId = vm.id;
  state.wizard = null;
  saveState();
  setRoute({ name: "detail", id: vm.id });
}

function wizardToVM(id) {
  const w = state.wizard;
  return {
    id,
    name: w.name || defaultName(),
    os: "Linux",
    status: "Stopped",
    icon: assets.linux,
    notes: "Local browser VM config generated from UTM-Web. Import boot media into browser storage, then run it with the vendored QEMU-WASM engine.",
    runtime: w.runtime,
    architecture: w.architecture,
    machine: w.target,
    memory: w.memory,
    cpu: w.cpu,
    storage: w.storage,
    displayMode: w.displayMode,
    bootType: w.bootType,
    bootArguments: w.bootArguments,
    fileRefs: structuredClone(w.fileRefs),
    qemuArgs: [],
    network: "none"
  };
}

function defaultName() {
  const base = "Linux";
  const count = state.vms.filter(vm => vm.name.startsWith(base)).length;
  return count ? `${base} ${count + 1}` : base;
}

function fileMeta(file) {
  return {
    id: file.id,
    role: file.role,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
    savedAt: file.savedAt || Date.now()
  };
}

function openSettings() {
  const vm = vmById();
  state.editingId = vm.id;
  state.draft = structuredClone(vm);
  setRoute({ name: "settings" });
}

function renderSettingsRoot() {
  const vm = state.draft;
  renderNav(
    "Settings",
    navButton("Delete", "deleteDraftVM()", "destructive"),
    `${navButton("Cancel", "cancelSettings()")} ${navButton("Save", "saveSettings()", "strong")}`
  );
  $("view").innerHTML = `
    <section class="section">
      <div class="group">
        ${navRow("Information", "sf:info.circle", "icon-blue", "openSettingsPane('Information')")}
        ${navRow("System", "sf:cpu", "icon-orange", "openSettingsPane('System')")}
        ${navRow("Display", "sf:rectangle.on.rectangle", "icon-blue", "openSettingsPane('Display')")}
        ${navRow("Boot", "sf:externaldrive", "icon-yellow", "openSettingsPane('Boot')")}
        ${navRow("QEMU", "sf:shippingbox", "icon-purple", "openSettingsPane('QEMU')")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Runtime</p>
      <div class="group">
        ${row("Engine", runtimeLabel(vm))}
        ${row("Display", displayLabel(vm))}
        ${row("Network", networkLabel(vm))}
      </div>
    </section>
  `;
}

function openSettingsPane(pane) {
  setRoute({ name: "settingsPane", pane });
}

function renderSettingsPane() {
  const pane = state.route.pane;
  renderNav(
    pane,
    navButton("&lsaquo; Settings", "setRoute({ name: 'settings' })"),
    navButton("Save", "saveSettings()", "strong")
  );
  $("view").innerHTML = settingsPaneContent(pane);
}

function settingsPaneContent(pane) {
  const vm = state.draft;
  if (pane === "Information") {
    return `
      <section class="section">
        <p class="section-title">Name</p>
        <div class="group">${textInputRow("Name", vm.name, "setDraft('name', this.value)")}</div>
      </section>
      <section class="section">
        <p class="section-title">Notes</p>
        <div class="group"><label class="row"><textarea oninput="setDraft('notes', this.value)">${escapeHtml(vm.notes)}</textarea></label></div>
      </section>
    `;
  }
  if (pane === "System") {
    return `
      <section class="section">
        <p class="section-title">Hardware</p>
        <div class="group">
          ${selectRow("Architecture", vm.architecture, ["x86_64", "i386"], "setDraft('architecture', this.value)")}
          ${selectRow("Machine", vm.machine, ["q35", "pc"], "setDraft('machine', this.value)")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Memory</p>
        <div class="group">
          <div class="row">
            <span class="row-title">RAM</span>
            <span class="range-row">
              <input type="range" min="128" max="2048" step="128" value="${vm.memory}" oninput="setDraft('memory', Number(this.value)); this.nextElementSibling.value = this.value">
              <input type="number" value="${vm.memory}" oninput="setDraft('memory', Number(this.value))">
            </span>
          </div>
        </div>
      </section>
      <section class="section">
        <p class="section-title">CPU</p>
        <div class="group">${textInputRow("CPU Cores", vm.cpu, "setDraft('cpu', Number(this.value))", "number")}</div>
      </section>
    `;
  }
  if (pane === "Display") {
    return `
      <section class="section">
        <p class="section-title">Output</p>
        <div class="group">
          ${selectRow("Mode", vm.displayMode || "serial", ["serial", "graphical"], "setDraft('displayMode', this.value); render()")}
        </div>
        ${vm.displayMode === "graphical" ? `<p class="section-footer">Graphical mode removes -nographic and attaches the browser canvas as the QEMU display. The bundled x86_64 QEMU-WASM target is serial-first; use a canvas-enabled build for graphical guests.</p>` : ""}
      </section>
      <section class="section">
        <p class="section-title">Input</p>
        <div class="group">
          ${row("Mouse", "Pointer capture")}
          ${row("Touch", "Touchpad emulation")}
        </div>
      </section>
    `;
  }
  if (pane === "Boot") {
    return `
      <section class="section">
        <div class="group">${selectRow("Boot Type", vm.bootType, ["packaged-demo", "iso", "kernel", "disk"], "setDraft('bootType', this.value); render()")}</div>
      </section>
      ${vm.bootType === "packaged-demo" ? `
        <section class="section">
          <p class="section-title">Packaged Demo</p>
          <div class="group">${row("Image", "Local Alpine x86_64 from qemu-wasm-demo submodule")}</div>
        </section>
      ` : `
        ${vm.bootType === "iso" ? `
          <section class="section">
            <p class="section-title">CD/DVD</p>
            <div class="group">${fileRow("Boot ISO Image", "cdrom", "draft")}</div>
          </section>
        ` : ""}
        ${vm.bootType === "kernel" ? `
          <section class="section">
            <p class="section-title">Linux Kernel</p>
            <div class="group">
              ${fileRow("Kernel", "kernel", "draft")}
              ${fileRow("Initial Ramdisk", "initrd", "draft")}
            </div>
          </section>
        ` : ""}
        <section class="section">
          <p class="section-title">${vm.bootType === "iso" ? "Writable Disk" : "Disk"}</p>
          <div class="group">${fileRow("Disk Image", "disk", "draft")}</div>
          ${vm.bootType === "iso" ? `<p class="section-footer">Optional, but needed if you want the guest to install or save changes to a disk image.</p>` : ""}
        </section>
      `}
      <section class="section">
        <p class="section-title">Boot Arguments</p>
        <div class="group">${textInputRow("Append", vm.bootArguments, "setDraft('bootArguments', this.value)")}</div>
      </section>
    `;
  }
  if (pane === "QEMU") {
    const plan = buildQemuPlan(vm);
    return `
      <section class="section">
        <p class="section-title">Generated Arguments</p>
        ${codeBlock(`${plan.executable} ${shellQuoteArgs(plan.args)}`)}
      </section>
      <section class="section">
        <p class="section-title">Additional Arguments</p>
        <div class="group">${textInputRow("Arguments", vm.qemuArgs?.join(" ") || "", "setDraftArgs(this.value)")}</div>
      </section>
      <section class="section">
        <div class="group">
          ${navRow("Copy Arguments", "sf:doc.on.clipboard", "icon-blue", `copyDraftQemuArgs()`)}
          ${navRow("Export Config", "sf:square.and.arrow.down", "icon-green", `exportDraftConfig()`)}
        </div>
      </section>
    `;
  }
  return "";
}

function setDraft(key, value) {
  state.draft[key] = value;
}

function setDraftArgs(value) {
  state.draft.qemuArgs = splitArgs(value);
}

async function pickDraftFile(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  state.draft.fileRefs = state.draft.fileRefs || {};
  state.draft.fileRefs[key] = await importFileToStore(file, key);
  transientFiles.set(`${state.draft.id}:${key}`, file);
  render();
}

function saveSettings() {
  const index = state.vms.findIndex(vm => vm.id === state.editingId);
  if (index !== -1) {
    state.vms[index] = structuredClone(state.draft);
    state.selectedId = state.draft.id;
    state.vms[index].status = state.vms[index].bootType === "packaged-demo" ? "Ready" : "Stopped";
  }
  state.draft = null;
  saveState();
  setRoute({ name: "detail", id: state.selectedId });
}

function cancelSettings() {
  state.draft = null;
  setRoute({ name: "detail", id: state.selectedId });
}

function deleteDraftVM() {
  if (!state.draft || state.vms.length <= 1) return;
  state.vms = state.vms.filter(vm => vm.id !== state.draft.id);
  state.selectedId = state.vms[0].id;
  state.draft = null;
  saveState();
  setRoute({ name: "library" });
}

function buildQemuPlan(vm) {
  if (vm.bootType === "packaged-demo") {
    return {
      executable: "qemu-system-x86_64",
      args: [
        ...displayArgs(vm),
        "-M", "pc", "-m", "512M", "-accel", "tcg,tb-size=500",
        "-L", "/pack-rom/",
        "-nic", "none",
        "-kernel", "/pack-kernel/vmlinuz-virt",
        "-initrd", "/pack-initramfs/initramfs-virt",
        "-append", vm.bootArguments || "console=ttyS0 root=/dev/vda noautodetect hostname=demo",
        "-drive", "id=test,file=/pack-rootfs/disk-rootfs.img,format=raw,if=none",
        "-device", "virtio-blk-pci,drive=test"
      ]
    };
  }
  const args = [
    ...displayArgs(vm),
    "-M", vm.machine || "q35",
    "-m", `${vm.memory || 512}M`,
    "-accel", "tcg,tb-size=500",
    "-smp", String(Math.max(1, Number(vm.cpu || 1))),
    "-L", "/pack-rom/",
    "-nic", "none"
  ];
  if (vm.bootType === "kernel" && vm.fileRefs?.kernel) {
    args.push("-kernel", "/utm/kernel");
  }
  if (vm.bootType === "kernel" && vm.fileRefs?.initrd) {
    args.push("-initrd", "/utm/initrd");
  }
  if (vm.bootType === "kernel") {
    args.push("-append", vm.bootArguments || "console=ttyS0 root=/dev/vda rw");
  }
  if (vm.bootType === "iso" && vm.fileRefs?.cdrom) {
    args.push("-cdrom", "/utm/cdrom.iso");
    args.push("-boot", "d");
  }
  if (vm.fileRefs?.disk) {
    args.push("-drive", `id=utm0,file=/utm/disk.img,format=${diskFormat(vm.fileRefs.disk)},if=none`);
    args.push("-device", "virtio-blk-pci,drive=utm0");
  }
  if (Array.isArray(vm.qemuArgs) && vm.qemuArgs.length) {
    args.push(...vm.qemuArgs);
  }
  return { executable: "qemu-system-x86_64", args };
}

function displayArgs(vm) {
  if (vm.displayMode === "graphical") {
    return ["-display", "sdl,gl=off", "-serial", "mon:stdio", "-device", "usb-tablet"];
  }
  return ["-nographic"];
}

function shellQuoteArgs(args) {
  return args.map(arg => {
    if (/^[A-Za-z0-9_./:=,+-]+$/.test(arg)) return arg;
    return `'${arg.replaceAll("'", "'\\''")}'`;
  }).join(" ");
}

function splitArgs(value) {
  const matches = String(value || "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map(part => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1);
    }
    return part;
  });
}

async function startRuntime(id) {
  const vm = vmById(id);
  const session = runtimeSession;
  if (!session || session.vmId !== id) return;
  appendOutput(`UTM Web ${vm.name}`);
  appendOutput(`Runtime: ${runtimeLabel(vm)}`);
  appendOutput(`Command: ${buildQemuPlan(vm).executable} ${shellQuoteArgs(buildQemuPlan(vm).args)}`);
  appendOutput("");
  if (!("WebAssembly" in window)) {
    failRuntime(vm, "WebAssembly is not available in this browser.");
    return;
  }
  if (!("Worker" in window)) {
    failRuntime(vm, "Web Workers are not available in this browser.");
    return;
  }
  const missingFiles = requiredFileKeys(vm).filter(key => !vm.fileRefs?.[key]);
  if (missingFiles.length) {
    failRuntime(vm, `Missing ${missingFiles.map(fileTitle).join(", ")}.`);
    return;
  }
  const localRuntime = await resourceExists(qemuWasm.module);
  if (!localRuntime) {
    failRuntime(vm, `Local QEMU-WASM runtime not found at ${qemuWasm.module}.`);
    return;
  }
  try {
    session.status = "running";
    vm.status = "Running";
    saveState();
    appendOutput("Local QEMU-WASM runtime found in repo submodule.");
    appendOutput("Preparing QEMU filesystem...");
    await startLocalQemu(vm);
  } catch (error) {
    failRuntime(vm, error.message || String(error));
  }
}

function appendOutput(line) {
  if (!runtimeSession) return;
  runtimeSession.output.push(String(line));
  trimRuntimeOutput();
  const output = $("terminalOutput");
  if (output) {
    output.textContent = runtimeSession.output.join("\n");
    output.scrollTop = output.scrollHeight;
  }
}

function appendTerminalBytes(bytes) {
  if (!runtimeSession) return;
  const text = terminalDecoder.decode(new Uint8Array(bytes));
  const cleaned = text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
  const parts = cleaned.split("\n");
  if (!runtimeSession.output.length) runtimeSession.output.push("");
  runtimeSession.output[runtimeSession.output.length - 1] += parts.shift() || "";
  for (const part of parts) runtimeSession.output.push(part);
  trimRuntimeOutput();
  const output = $("terminalOutput");
  if (output) {
    output.textContent = runtimeSession.output.join("\n");
    output.scrollTop = output.scrollHeight;
  }
}

function trimRuntimeOutput() {
  if (!runtimeSession || runtimeSession.output.length <= 1200) return;
  runtimeSession.output.splice(0, runtimeSession.output.length - 1200);
}

function failRuntime(vm, message) {
  if (runtimeSession) {
    runtimeSession.status = "stopped";
    appendOutput(`Stopped: ${message}`);
  }
  vm.status = vm.bootType === "packaged-demo" ? "Ready" : "Stopped";
  saveState();
  render();
}

async function resourceExists(url) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch (_) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

async function startLocalQemu(vm) {
  const plan = buildQemuPlan(vm);
  const payloads = {};
  for (const key of Object.keys(vm.fileRefs || {})) {
    const bytes = await readStoredBytes(vm.fileRefs[key], `${vm.id}:${key}`);
    if (bytes) payloads[key] = bytes;
  }
  const missingRuntimeFiles = requiredFileKeys(vm).filter(key => !payloads[key]);
  if (missingRuntimeFiles.length) {
    throw new Error(`Stored ${missingRuntimeFiles.map(fileTitle).join(", ")} data is missing. Re-import the file.`);
  }
  if (runtimeSession) {
    runtimeSession.diskRef = vm.fileRefs?.disk || null;
  }
  const pty = createBrowserPty();
  if (runtimeSession) runtimeSession.pty = pty;
  const displayCanvas = $("qemuCanvas");
  const previousModule = window.Module;
  window.Module = {
    arguments: plan.args,
    locateFile: path => runtimeUrl(`${qemuWasm.root}${path}`),
    mainScriptUrlOrBlob: runtimeUrl(qemuWasm.module),
    canvas: displayCanvas || undefined,
    pty,
    print: appendOutput,
    printErr: line => appendOutput(line),
    setStatus: status => appendOutput(status),
    preRun: [mod => {
      try {
        mod.FS.mkdir("/utm");
      } catch (_) {
        // Directory already exists when the runtime re-enters preRun.
      }
      if (payloads.kernel) mod.FS.writeFile("/utm/kernel", payloads.kernel);
      if (payloads.initrd) mod.FS.writeFile("/utm/initrd", payloads.initrd);
      if (payloads.disk) mod.FS.writeFile("/utm/disk.img", payloads.disk);
      if (payloads.cdrom) mod.FS.writeFile("/utm/cdrom.iso", payloads.cdrom);
    }],
    onExit: code => appendOutput(`QEMU exited with code ${code}.`)
  };
  try {
    appendOutput(`Worker script: ${runtimeUrl(qemuWasm.module)}`);
    await loadClassicScript(qemuWasm.packageLoaders.rom);
    if (vm.bootType === "packaged-demo") {
      await loadClassicScript(qemuWasm.packageLoaders.kernel);
      await loadClassicScript(qemuWasm.packageLoaders.initramfs);
      await loadClassicScript(qemuWasm.packageLoaders.rootfs);
    }
    const module = await import(runtimeUrl(qemuWasm.module));
    if (typeof module.default === "function") {
      runtimeSession.module = await module.default(window.Module);
    }
  } catch (error) {
    window.Module = previousModule;
    throw error;
  }
}

function createBrowserPty() {
  const input = [];
  const readableHandlers = new Set();
  const signalHandlers = new Set();
  let termios = {
    iflag: 0,
    oflag: 0,
    cflag: 0,
    lflag: 0,
    cc: new Array(32).fill(0)
  };
  const notifyReadable = () => {
    for (const handler of readableHandlers) handler();
  };
  return {
    get readable() {
      return input.length > 0;
    },
    get writable() {
      return true;
    },
    read(length) {
      return input.splice(0, length);
    },
    write(bytes) {
      appendTerminalBytes(bytes);
    },
    push(text) {
      input.push(...terminalEncoder.encode(text));
      notifyReadable();
    },
    signal(name) {
      for (const handler of signalHandlers) handler(name);
    },
    onReadable(handler) {
      readableHandlers.add(handler);
      return { dispose: () => readableHandlers.delete(handler) };
    },
    onSignal(handler) {
      signalHandlers.add(handler);
      return { dispose: () => signalHandlers.delete(handler) };
    },
    ioctl(request, value) {
      if (request === "TCGETS") return termios;
      if (request === "TCSETS") {
        termios = { ...termios, ...value };
        return 0;
      }
      if (request === "TIOCGWINSZ") return [120, 40];
      return 0;
    }
  };
}

function runtimeUrl(path) {
  return new URL(path, window.location.href).href;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = runtimeUrl(src);
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}.`));
    document.body.appendChild(script);
  });
}

function renderDisplay() {
  const vm = vmById(state.route.id);
  const session = runtimeSession && runtimeSession.vmId === vm.id ? runtimeSession : {
    status: "stopped",
    output: ["No active runtime session."],
    diskRef: null
  };
  $("view").className = "view display-view";
  const plan = buildQemuPlan(vm);
  const mode = vm.displayMode === "graphical" ? "graphical" : "serial";
  $("view").innerHTML = `
    <div class="display-surface ${mode}">
      <canvas id="qemuCanvas" class="qemu-canvas" width="1024" height="768" tabindex="0" aria-label="QEMU display"></canvas>
      <pre id="terminalOutput" class="terminal-output" tabindex="0">${escapeHtml(session.output.join("\n"))}</pre>
      <div class="floating-toolbar">
        <button onclick="saveActiveDisk()">SAVE</button>
        <button onclick="restartDisplay()">RST</button>
        <button onclick="copyQemuArgs('${vm.id}')">ARG</button>
        <button onclick="stopDisplay()">X</button>
      </div>
      <div class="runtime-chip">${escapeHtml(session.status)} · ${escapeHtml(plan.executable)}</div>
    </div>
  `;
  setupDisplayInput($("qemuCanvas"));
  setupConsoleInput($("terminalOutput"));
  const output = $("terminalOutput");
  if (output) output.scrollTop = output.scrollHeight;
}

function setupDisplayInput(canvas) {
  if (!canvas) return;
  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(640, Math.round(rect.width * scale));
    const height = Math.max(480, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas, { passive: true });
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  canvas.addEventListener("pointerdown", event => {
    canvas.focus();
    canvas.setPointerCapture?.(event.pointerId);
    if (event.pointerType === "touch") mirrorTouchPointer(canvas, event, "mousedown");
  });
  canvas.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") mirrorTouchPointer(canvas, event, "mousemove");
  });
  canvas.addEventListener("pointerup", event => {
    if (event.pointerType === "touch") mirrorTouchPointer(canvas, event, "mouseup");
    releaseCanvasPointer(canvas, event.pointerId);
  });
  canvas.addEventListener("pointercancel", event => {
    if (event.pointerType === "touch") mirrorTouchPointer(canvas, event, "mouseup");
    releaseCanvasPointer(canvas, event.pointerId);
  });
  canvas.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
  canvas.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
  canvas.addEventListener("wheel", () => canvas.focus(), { passive: true });
  canvas.addEventListener("keydown", sendConsoleKey);
}

function setupConsoleInput(element) {
  if (!element) return;
  element.addEventListener("pointerdown", () => element.focus());
  element.addEventListener("keydown", sendConsoleKey);
}

function sendConsoleKey(event) {
  const pty = runtimeSession?.pty;
  if (!pty) return;
  let text = "";
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    pty.signal("SIGINT");
    text = "\x03";
  } else if (event.key === "Enter") {
    text = "\r";
  } else if (event.key === "Backspace") {
    text = "\x7f";
  } else if (event.key === "Tab") {
    text = "\t";
  } else if (event.key === "Escape") {
    text = "\x1b";
  } else if (event.key === "ArrowUp") {
    text = "\x1b[A";
  } else if (event.key === "ArrowDown") {
    text = "\x1b[B";
  } else if (event.key === "ArrowRight") {
    text = "\x1b[C";
  } else if (event.key === "ArrowLeft") {
    text = "\x1b[D";
  } else if (event.key.length === 1 && !event.metaKey) {
    text = event.key;
  }
  if (!text) return;
  event.preventDefault();
  pty.push(text);
}

function releaseCanvasPointer(canvas, pointerId) {
  try {
    canvas.releasePointerCapture?.(pointerId);
  } catch (_) {
    // Some browsers report cancelled touch pointers as already released.
  }
}

function mirrorTouchPointer(canvas, event, type) {
  event.preventDefault();
  canvas.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1
  }));
}

function stopDisplay() {
  const vm = vmById(state.route.id);
  vm.status = vm.bootType === "packaged-demo" ? "Ready" : "Stopped";
  runtimeSession = null;
  saveState();
  setRoute({ name: "detail", id: vm.id });
}

function restartDisplay() {
  const id = state.route.id;
  stopDisplay();
  runVM(id);
}

function openURL(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function saveActiveDisk() {
  if (!runtimeSession?.module) {
    appendOutput("Save skipped: QEMU module is not ready yet.");
    return;
  }
  if (!runtimeSession.diskRef) {
    appendOutput("Save skipped: this VM has no writable disk image attached.");
    return;
  }
  const fs = runtimeSession.module.FS || window.Module?.FS;
  if (!fs) {
    appendOutput("Save skipped: QEMU filesystem is unavailable.");
    return;
  }
  try {
    const bytes = fs.readFile(runtimeSession.diskPath);
    const updated = await updateStoredBytes(runtimeSession.diskRef, bytes);
    const vm = vmById(runtimeSession.vmId);
    vm.fileRefs.disk = updated;
    runtimeSession.diskRef = updated;
    vm.status = "Saved";
    saveState();
    appendOutput(`Saved ${updated.name} (${formatBytes(updated.size)}) to browser storage.`);
  } catch (error) {
    appendOutput(`Save failed: ${error.message || error}`);
  }
}

async function copyQemuArgs(id = state.selectedId) {
  const vm = vmById(id);
  const plan = buildQemuPlan(vm);
  await navigator.clipboard.writeText(`${plan.executable} ${shellQuoteArgs(plan.args)}`);
  showToast("QEMU arguments copied");
}

async function copyDraftQemuArgs() {
  const plan = buildQemuPlan(state.draft);
  await navigator.clipboard.writeText(`${plan.executable} ${shellQuoteArgs(plan.args)}`);
  showToast("QEMU arguments copied");
}

function exportConfig(id = state.selectedId) {
  downloadConfig(vmById(id));
}

function exportDraftConfig() {
  downloadConfig(state.draft);
}

function downloadConfig(vm) {
  const payload = {
    format: "utm-web",
    version: 1,
    vm,
    qemu: buildQemuPlan(vm)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${vm.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.utmweb.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadAttachedFile(id, key) {
  const vm = vmById(id);
  const ref = vm.fileRefs?.[key];
  if (!ref) {
    showToast("No file attached");
    return;
  }
  const bytes = await readStoredBytes(ref, `${vm.id}:${key}`);
  if (!bytes) {
    showToast("Stored file is missing");
    return;
  }
  const blob = new Blob([bytes], { type: ref.type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = ref.name || `${key}.img`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  state.actionSheet = {
    title: message,
    actions: [["OK", "hideSheet()"]]
  };
  renderActionSheet();
}

function showRuntimeSheet() {
  state.actionSheet = {
    title: "QEMU-WASM Runtime",
    actions: [
      ["Open Upstream Repository", `openURL('${qemuWasm.upstream}'); hideSheet()`],
      ["Enable Isolation Headers", "enableIsolation()"],
      ["Disable Isolation Headers", "disableIsolation()"],
      ["Open Local Runtime Notes", `openURL('${qemuWasm.docs}'); hideSheet()`]
    ]
  };
  renderActionSheet();
}

function showImportConfigSheet() {
  state.actionSheet = {
    title: "Import Config",
    custom: `
      <div class="sheet-import">
        <input type="file" accept="application/json,.json,.utmweb" onchange="importConfig(this)">
      </div>
    `,
    actions: []
  };
  renderActionSheet();
}

async function importConfig(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const vm = parsed.vm || parsed;
    vm.id = `vm-${Date.now()}`;
    vm.status = vm.bootType === "packaged-demo" ? "Ready" : "Stopped";
    state.vms.push(vm);
    state.selectedId = vm.id;
    saveState();
    hideSheet();
    setRoute({ name: "detail", id: vm.id });
  } catch (error) {
    showToast("Could not import config");
  }
}

function hideSheet() {
  state.actionSheet = null;
  renderActionSheet();
}

async function enableIsolation() {
  localStorage.removeItem("utm-web-disable-isolation");
  if (!("serviceWorker" in navigator)) {
    showToast("Service workers unavailable");
    return;
  }
  if (!window.isSecureContext) {
    showToast("Use HTTPS or localhost");
    return;
  }
  await navigator.serviceWorker.register("coi-serviceworker.js");
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    showToast("Reloading with isolation");
    return;
  }
  window.location.reload();
}

async function disableIsolation() {
  localStorage.setItem("utm-web-disable-isolation", "1");
  if (!("serviceWorker" in navigator)) {
    showToast("Service workers unavailable");
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));
  window.location.reload();
}

async function ensureIsolation() {
  if (localStorage.getItem("utm-web-disable-isolation") === "1") return;
  if (crossOriginIsolated) {
    sessionStorage.removeItem("utm-web-isolation-reload");
    return;
  }
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  await navigator.serviceWorker.register("coi-serviceworker.js");
  if (!sessionStorage.getItem("utm-web-isolation-reload")) {
    sessionStorage.setItem("utm-web-isolation-reload", "1");
    window.location.reload();
  }
}

function renderActionSheet() {
  const sheet = $("actionSheet");
  if (!state.actionSheet) {
    sheet.className = "action-sheet";
    sheet.setAttribute("aria-hidden", "true");
    sheet.innerHTML = "";
    return;
  }
  sheet.className = "action-sheet active";
  sheet.setAttribute("aria-hidden", "false");
  sheet.innerHTML = `
    <div class="sheet-stack">
      <div class="sheet-group">
        <div class="sheet-title">${escapeHtml(state.actionSheet.title)}</div>
        ${state.actionSheet.custom || ""}
        ${(state.actionSheet.actions || []).map(action => `<button class="sheet-action" onclick="${action[1]}">${escapeHtml(action[0])}</button>`).join("")}
      </div>
      <div class="sheet-group"><button class="sheet-action cancel" onclick="hideSheet()">Cancel</button></div>
    </div>
  `;
}

ensureIsolation().catch(error => console.warn(error));
render();
