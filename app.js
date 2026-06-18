/*
  UTM Web functional browser prototype.
  UI references:
  - UTM-main/Platform/iOS/VMWizardView.swift
  - UTM-main/Platform/iOS/VMSettingsView.swift
  - UTM-main/Platform/iOS/VMToolbarView.swift
  Runtime references:
  - UTM-main/Configuration/UTMQemuConfiguration.swift
  - /Users/jackpilkington/Documents/Playground/v86-master/src/browser/starter.js
  - /Users/jackpilkington/Documents/Playground/v86-master/v86.d.ts
*/

const assets = {
  utm: "assets/utm-icon.png",
  linux: "assets/logo-linux.png",
  alpine: "assets/Icons/alpine.png"
};

const v86Runtime = {
  module: "vendor/v86/build/libv86.mjs",
  wasm: "vendor/v86/build/v86.wasm",
  fallbackWasm: "vendor/v86/build/v86-fallback.wasm",
  bios: "vendor/v86/bios/seabios.bin",
  vgaBios: "vendor/v86/bios/vgabios.bin",
  docs: "vendor/v86/Readme.md",
  upstream: "https://github.com/copy/v86",
  bootOrders: {
    cdrom: 0x123,
    disk: 0x132,
    floppy: 0x231,
    auto: 0
  }
};

const supportedMachines = [
  { title: "v86 PC (x86)", arch: "x86", target: "pc", memory: 256, storage: 1, cpu: 1 }
];

const storageDbName = "utm-web-storage";
const storageStoreName = "files";

const defaults = {
  route: { name: "library" },
  selectedId: "custom-pc",
  editingId: null,
  draft: null,
  wizard: null,
  actionSheet: null,
  vms: [
    {
      id: "custom-pc",
      name: "Custom x86 PC",
      os: "Linux",
      status: "Stopped",
      icon: assets.linux,
      notes: "A local v86 PC configuration. Import an ISO, raw disk, floppy image, or Linux bzImage into browser storage and boot it with the vendored v86 runtime.",
      runtime: "local-v86",
      architecture: "x86",
      machine: "pc",
      memory: 256,
      cpu: 1,
      storage: 1,
      vgaMemory: 8,
      displayMode: "graphical",
      bootType: "iso",
      bootArguments: "",
      fileRefs: {},
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
      const legacyDefaultIds = new Set(["alpine-demo", "linux-custom"]);
      const migrated = saved.vms
        .map(migrateVM)
        .filter(Boolean)
        .filter(vm => !defaultIds.has(vm.id) && !legacyDefaultIds.has(vm.id));
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
  const legacyRuntime = vm.runtime && vm.runtime !== "local-v86";
  if (vm.runtime === "local-v86" || legacyRuntime || vm.os === "Linux" || ["x86", "x86_64", "i386"].includes(vm.architecture)) {
    const bootType = vm.bootType === "packaged-demo" ? "iso" : (vm.bootType || "iso");
    return {
      ...structuredClone(defaults.vms[0]),
      id: vm.id || `vm-${Date.now()}`,
      name: vm.name || "Linux",
      notes: /runtime files|hosted demo|demo site/i.test(vm.notes || "")
        ? "Migrated to the local v86 runtime. Reattach boot media if the old demo files were used."
        : (vm.notes || "Local browser VM config generated from UTM-Web for v86."),
      runtime: "local-v86",
      architecture: "x86",
      machine: "pc",
      memory: Math.max(16, Number(vm.memory || 256)),
      cpu: 1,
      storage: Number(vm.storage || 1),
      vgaMemory: Number(vm.vgaMemory || 8),
      displayMode: vm.displayMode === "serial" ? "serial" : "graphical",
      bootType,
      bootArguments: vm.bootArguments || "",
      fileRefs: vm.fileRefs || {},
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

async function putBytesToStore(name, role, bytes, type = "application/octet-stream") {
  const blob = new Blob([bytes], { type });
  const record = {
    id: storageId(role),
    role,
    name,
    size: blob.size,
    type,
    lastModified: Date.now(),
    savedAt: Date.now(),
    blob
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
    disk: ".raw,.img,.qcow2,.qcow,.vmdk",
    cdrom: ".iso,.img",
    floppy: ".img,.ima,.flp",
    state: ".bin,.v86state"
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
  const config = formatV86Config(vm);
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
        ${row("VGA Memory", `${vm.vgaMemory || 8} MiB`)}
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
          ${vm.fileRefs?.state ? navRow("Download Save State", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'state')`) : ""}
        </div>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">v86</p>
      <div class="group">
        ${navRow("Copy Launch Config", "sf:doc.on.clipboard", "icon-blue", `copyV86Config('${vm.id}')`)}
        ${navRow("Export Config", "sf:square.and.arrow.down", "icon-green", `exportConfig('${vm.id}')`)}
      </div>
      ${codeBlock(config)}
    </section>
    <section class="section">
      <p class="section-title">Notes</p>
      <div class="group"><p class="detail-notes">${escapeHtml(vm.notes)}</p></div>
    </section>
  `;
}

function runtimeLabel(vm) {
  return "Local v86";
}

function networkLabel(vm) {
  return "None";
}

function displayLabel(vm) {
  return vm.displayMode === "serial" ? "Serial log" : "VGA display";
}

function bootLabel(vm) {
  if (vm.bootType === "kernel") return "Linux bzImage";
  if (vm.bootType === "iso") return "Boot ISO image";
  if (vm.bootType === "floppy") return "Floppy image";
  return "Raw disk image";
}

function requiredFileKeys(vm) {
  if (vm.bootType === "kernel") return ["kernel"];
  if (vm.bootType === "iso") return ["cdrom"];
  if (vm.bootType === "floppy") return ["floppy"];
  return ["disk"];
}

function fileTitle(key) {
  return {
    kernel: "Kernel",
    initrd: "Initial Ramdisk",
    disk: "Disk Image",
    cdrom: "CD/DVD Image",
    floppy: "Floppy Image",
    state: "Save State"
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
    runtime: "local-v86",
    machineIndex: 0,
    architecture: "x86",
    target: "pc",
    memory: 256,
    cpu: 1,
    vgaMemory: 8,
    storage: 2,
    displayMode: "graphical",
    bootType: "iso",
    bootArguments: "",
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
          <span class="choice-copy"><strong>Linux</strong><span>v86 x86 system emulation in the browser.</span></span>
          <span class="checkmark">&#10003;</span>
        </button>
      </div>
    </section>
    <section class="section">
      <p class="section-title">Runtime</p>
      <div class="group">
        ${row("Engine", "v86")}
        ${row("Display", "VGA + serial log")}
        ${row("Acceleration", "WebAssembly JIT")}
        ${row("Network", "Off")}
      </div>
    </section>
  `;
}

function wizardBoot() {
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Boot Type", state.wizard.bootType, ["iso", "disk", "floppy", "kernel"], "setWizardValue('bootType', this.value)")}
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
    ${state.wizard.bootType === "floppy" ? `
      <section class="section">
        <p class="section-title">Floppy</p>
        <div class="group">${fileRow("Floppy Image", "floppy")}</div>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">${state.wizard.bootType === "iso" ? "Writable Disk" : "Storage"}</p>
      <div class="group">${fileRow("Disk Image", "disk")}</div>
      ${state.wizard.bootType !== "disk" ? `<p class="section-footer">Optional, but needed if you want the guest to install or persist data on a disk image.</p>` : ""}
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
      ${state.wizard.displayMode === "graphical" ? `<p class="section-footer">Graphical mode is v86's VGA canvas with mouse, touch, and keyboard routed to the emulated PC.</p>` : ""}
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
    <section class="section">
      <p class="section-title">Video Memory</p>
      <div class="group">
        <div class="row">
          <span class="row-title">VGA RAM</span>
          <span class="range-row">
            <input type="range" min="1" max="32" step="1" value="${state.wizard.vgaMemory}" oninput="setWizardSilent('vgaMemory', Number(this.value)); this.nextElementSibling.value = this.value">
            <input type="number" value="${state.wizard.vgaMemory}" oninput="setWizardSilent('vgaMemory', Number(this.value))">
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
  const config = formatV86Config(preview);
  return `
    <section class="section">
      <p class="section-title">Information</p>
      <div class="group">${textInputRow("Name", name, "setWizardSilent('name', this.value)")}</div>
    </section>
    <section class="section">
      <p class="section-title">System</p>
      <div class="group">
        ${row("Engine", "v86")}
        ${row("Architecture", preview.architecture)}
        ${row("Machine", preview.machine)}
        ${row("Display", displayLabel(preview))}
        ${row("RAM", `${preview.memory} MiB`)}
        ${row("VGA RAM", `${preview.vgaMemory || 8} MiB`)}
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
      <p class="section-title">v86</p>
      ${codeBlock(config)}
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
    notes: "Local browser VM config generated from UTM-Web. Import boot media into browser storage, then run it with the vendored v86 engine.",
    runtime: w.runtime,
    architecture: w.architecture,
    machine: w.target,
    memory: w.memory,
    cpu: w.cpu,
    storage: w.storage,
    vgaMemory: w.vgaMemory,
    displayMode: w.displayMode,
    bootType: w.bootType,
    bootArguments: w.bootArguments,
    fileRefs: structuredClone(w.fileRefs),
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
        ${navRow("v86", "sf:shippingbox", "icon-purple", "openSettingsPane('v86')")}
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
          ${selectRow("Architecture", vm.architecture, ["x86"], "setDraft('architecture', this.value)")}
          ${selectRow("Machine", vm.machine, ["pc"], "setDraft('machine', this.value)")}
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
        ${vm.displayMode === "graphical" ? `<p class="section-footer">Graphical mode uses v86's browser screen adapter. Tap the display to focus keyboard and pointer input.</p>` : ""}
      </section>
      <section class="section">
        <p class="section-title">Input</p>
        <div class="group">
          ${row("Mouse", "Pointer capture")}
          ${row("Touch", "Touchpad emulation")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Video Memory</p>
        <div class="group">
          <div class="row">
            <span class="row-title">VGA RAM</span>
            <span class="range-row">
              <input type="range" min="1" max="32" step="1" value="${vm.vgaMemory || 8}" oninput="setDraft('vgaMemory', Number(this.value)); this.nextElementSibling.value = this.value">
              <input type="number" value="${vm.vgaMemory || 8}" oninput="setDraft('vgaMemory', Number(this.value))">
            </span>
          </div>
        </div>
      </section>
    `;
  }
  if (pane === "Boot") {
    return `
      <section class="section">
        <div class="group">${selectRow("Boot Type", vm.bootType, ["iso", "disk", "floppy", "kernel"], "setDraft('bootType', this.value); render()")}</div>
      </section>
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
        ${vm.bootType === "floppy" ? `
          <section class="section">
            <p class="section-title">Floppy</p>
            <div class="group">${fileRow("Floppy Image", "floppy", "draft")}</div>
          </section>
        ` : ""}
        <section class="section">
          <p class="section-title">${vm.bootType === "iso" ? "Writable Disk" : "Disk"}</p>
          <div class="group">${fileRow("Disk Image", "disk", "draft")}</div>
          ${vm.bootType === "iso" ? `<p class="section-footer">Optional, but needed if you want the guest to install or save changes to a disk image.</p>` : ""}
        </section>
      <section class="section">
        <p class="section-title">Boot Arguments</p>
        <div class="group">${textInputRow("Append", vm.bootArguments, "setDraft('bootArguments', this.value)")}</div>
      </section>
    `;
  }
  if (pane === "v86") {
    const config = formatV86Config(vm);
    return `
      <section class="section">
        <p class="section-title">Generated Config</p>
        ${codeBlock(config)}
      </section>
      <section class="section">
        <p class="section-title">Save State</p>
        <div class="group">
          ${vm.fileRefs?.state ? row("State", `${vm.fileRefs.state.name} · ${formatBytes(vm.fileRefs.state.size)}`) : row("State", "None saved")}
          ${fileRow("Restore State", "state", "draft")}
        </div>
      </section>
      <section class="section">
        <div class="group">
          ${navRow("Copy Config", "sf:doc.on.clipboard", "icon-blue", `copyDraftV86Config()`)}
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
    state.vms[index].status = "Stopped";
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

function v86BootOrder(vm) {
  if (vm.bootType === "disk") return v86Runtime.bootOrders.disk;
  if (vm.bootType === "floppy") return v86Runtime.bootOrders.floppy;
  return v86Runtime.bootOrders.cdrom;
}

function v86ConfigPreview(vm) {
  const config = {
    wasm_path: v86Runtime.wasm,
    bios: v86Runtime.bios,
    vga_bios: v86Runtime.vgaBios,
    memory_size: `${vm.memory || 256} MiB`,
    vga_memory_size: `${vm.vgaMemory || 8} MiB`,
    boot_order: `0x${v86BootOrder(vm).toString(16)}`,
    autostart: true,
    disable_speaker: true,
    network: "disabled"
  };
  if (vm.bootType === "iso") config.cdrom = vm.fileRefs?.cdrom?.name || "choose an ISO";
  if (vm.bootType === "disk" || vm.fileRefs?.disk) config.hda = vm.fileRefs?.disk?.name || "choose a raw disk";
  if (vm.bootType === "floppy") config.fda = vm.fileRefs?.floppy?.name || "choose a floppy image";
  if (vm.bootType === "kernel") {
    config.bzimage = vm.fileRefs?.kernel?.name || "choose a bzImage";
    if (vm.fileRefs?.initrd) config.initrd = vm.fileRefs.initrd.name;
    if (vm.bootArguments) config.cmdline = vm.bootArguments;
  }
  if (vm.fileRefs?.state) config.initial_state = vm.fileRefs.state.name;
  return config;
}

function formatV86Config(vm) {
  return JSON.stringify(v86ConfigPreview(vm), null, 2);
}

function buildV86Plan(vm) {
  return { executable: "v86", args: [formatV86Config(vm)] };
}

async function startRuntime(id) {
  const vm = vmById(id);
  const session = runtimeSession;
  if (!session || session.vmId !== id) return;
  appendOutput(`UTM Web ${vm.name}`);
  appendOutput(`Runtime: ${runtimeLabel(vm)}`);
  appendOutput("Engine: v86");
  appendOutput(formatV86Config(vm));
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
  const localRuntime = await resourceExists(v86Runtime.module);
  if (!localRuntime) {
    failRuntime(vm, `Local v86 runtime not found at ${v86Runtime.module}.`);
    return;
  }
  try {
    session.status = "running";
    vm.status = "Running";
    saveState();
    appendOutput("Local v86 runtime found in repo.");
    appendOutput("Preparing v86 machine...");
    await startLocalV86(vm);
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
  vm.status = "Stopped";
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

async function startLocalV86(vm) {
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
  const screen = $("v86Screen");
  if (!screen) throw new Error("v86 screen is not mounted.");
  const { V86 } = await import(runtimeUrl(v86Runtime.module));
  const options = {
    wasm_path: runtimeUrl(v86Runtime.wasm),
    memory_size: Math.max(16, Number(vm.memory || 256)) * 1024 * 1024,
    vga_memory_size: Math.max(1, Number(vm.vgaMemory || 8)) * 1024 * 1024,
    screen_container: screen,
    bios: { url: runtimeUrl(v86Runtime.bios) },
    vga_bios: { url: runtimeUrl(v86Runtime.vgaBios) },
    boot_order: v86BootOrder(vm),
    autostart: true,
    disable_speaker: true,
    disable_mouse: vm.displayMode === "serial",
    net_device: undefined
  };
  if (payloads.cdrom) options.cdrom = { buffer: uint8ToArrayBuffer(payloads.cdrom) };
  if (payloads.disk) options.hda = { buffer: uint8ToArrayBuffer(payloads.disk) };
  if (payloads.floppy) options.fda = { buffer: uint8ToArrayBuffer(payloads.floppy) };
  if (payloads.kernel) options.bzimage = { buffer: uint8ToArrayBuffer(payloads.kernel) };
  if (payloads.initrd) options.initrd = { buffer: uint8ToArrayBuffer(payloads.initrd) };
  if (payloads.state) options.initial_state = { buffer: uint8ToArrayBuffer(payloads.state) };
  if (vm.bootArguments) options.cmdline = vm.bootArguments;
  const emulator = new V86(options);
  runtimeSession.emulator = emulator;
  runtimeSession.module = emulator;
  emulator.add_listener("download-progress", progress => {
    if (progress?.total) appendOutput(`Downloading ${progress.file_name || "runtime"}: ${progress.loaded}/${progress.total}`);
  });
  emulator.add_listener("emulator-ready", () => {
    runtimeSession.status = "running";
    appendOutput("v86 ready.");
    renderDisplay();
  });
  emulator.add_listener("emulator-stopped", () => appendOutput("v86 stopped."));
  emulator.add_listener("serial0-output-byte", byte => appendTerminalBytes([byte]));
}

function uint8ToArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function runtimeUrl(path) {
  return new URL(path, window.location.href).href;
}

function renderDisplay() {
  const vm = vmById(state.route.id);
  const session = runtimeSession && runtimeSession.vmId === vm.id ? runtimeSession : {
    status: "stopped",
    output: ["No active runtime session."],
    diskRef: null
  };
  $("view").className = "view display-view";
  const plan = buildV86Plan(vm);
  const mode = vm.displayMode === "graphical" ? "graphical" : "serial";
  $("view").innerHTML = `
    <div class="display-surface ${mode}">
      <div id="v86Screen" class="v86-screen" tabindex="0" aria-label="v86 display">
        <canvas></canvas>
        <div></div>
      </div>
      <pre id="terminalOutput" class="terminal-output" tabindex="0">${escapeHtml(session.output.join("\n"))}</pre>
      <form class="serial-input" onsubmit="sendSerialInput(event)">
        <input id="serialTextInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="send" aria-label="Serial input">
        <button type="submit">RET</button>
      </form>
      <div class="floating-toolbar">
        <button onclick="saveActiveDisk()">SAVE</button>
        <button onclick="sendSerialText('\r')">ENT</button>
        <button onclick="restartDisplay()">RST</button>
        <button onclick="copyV86Config('${vm.id}')">CFG</button>
        <button onclick="stopDisplay()">X</button>
      </div>
      <div class="runtime-chip">${escapeHtml(session.status)} · ${escapeHtml(plan.executable)}</div>
    </div>
  `;
  setupV86Input($("v86Screen"));
  setupConsoleInput($("terminalOutput"));
  const output = $("terminalOutput");
  if (output) output.scrollTop = output.scrollHeight;
}

function setupV86Input(screen) {
  if (!screen) return;
  screen.addEventListener("pointerdown", () => screen.focus());
  screen.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
  screen.addEventListener("touchmove", event => event.preventDefault(), { passive: false });
}

function setupConsoleInput(element) {
  if (!element) return;
  element.addEventListener("pointerdown", event => {
    element.focus();
    if (event.pointerType === "touch") $("serialTextInput")?.focus();
  });
  element.addEventListener("keydown", sendConsoleKey);
}

function sendConsoleKey(event) {
  let text = "";
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
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
  sendSerialText(text);
}

function sendSerialInput(event) {
  event.preventDefault();
  const input = $("serialTextInput");
  const text = input?.value || "";
  if (text) sendSerialText(text);
  sendSerialText("\r");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function sendSerialText(text) {
  const emulator = runtimeSession?.emulator;
  if (!emulator) {
    appendOutput("Serial input skipped: v86 is not ready yet.");
    return;
  }
  emulator.serial0_send(text);
}

async function stopDisplay() {
  const vm = vmById(state.route.id);
  const session = runtimeSession;
  if (session?.emulator) {
    try {
      await session.emulator.stop();
      await session.emulator.destroy();
    } catch (error) {
      console.warn(error);
    }
  }
  vm.status = "Stopped";
  runtimeSession = null;
  saveState();
  setRoute({ name: "detail", id: vm.id });
}

async function restartDisplay() {
  const id = state.route.id;
  await stopDisplay();
  runVM(id);
}

function openURL(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function saveActiveDisk() {
  if (!runtimeSession?.emulator) {
    appendOutput("Save skipped: v86 is not ready yet.");
    return;
  }
  try {
    const bytes = await runtimeSession.emulator.save_state();
    const vm = vmById(runtimeSession.vmId);
    const safeName = vm.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "utm-web";
    const updated = await putBytesToStore(`${safeName}.v86state.bin`, "state", bytes);
    vm.fileRefs = vm.fileRefs || {};
    vm.fileRefs.state = updated;
    vm.status = "Saved";
    saveState();
    appendOutput(`Saved v86 state (${formatBytes(updated.size)}) to browser storage.`);
  } catch (error) {
    appendOutput(`Save failed: ${error.message || error}`);
  }
}

async function copyV86Config(id = state.selectedId) {
  const vm = vmById(id);
  await navigator.clipboard.writeText(formatV86Config(vm));
  showToast("v86 config copied");
}

async function copyDraftV86Config() {
  await navigator.clipboard.writeText(formatV86Config(state.draft));
  showToast("v86 config copied");
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
    v86: v86ConfigPreview(vm)
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
    title: "v86 Runtime",
    actions: [
      ["Open Upstream Repository", `openURL('${v86Runtime.upstream}'); hideSheet()`],
      ["Enable Isolation Headers", "enableIsolation()"],
      ["Disable Isolation Headers", "disableIsolation()"],
      ["Open Local Runtime Notes", `openURL('${v86Runtime.docs}'); hideSheet()`]
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
    vm.status = "Stopped";
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
  await registerIsolationWorker();
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
  await registerIsolationWorker();
  if (!sessionStorage.getItem("utm-web-isolation-reload")) {
    sessionStorage.setItem("utm-web-isolation-reload", "1");
    window.location.reload();
  }
}

function registerIsolationWorker() {
  return navigator.serviceWorker.register("coi-serviceworker.js?v=v86-20260618-3", {
    updateViaCache: "none"
  });
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
