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
  module: "vendor/v64/build/libv86.mjs",
  docs: "vendor/v64/Readme.md",
  upstream: "https://github.com/speedyHKjournalist/v64"
};

const supportedMachines = [
  { title: "PC · x86 (32-bit)", arch: "x86", target: "i440fx", memory: 512, storage: 1, cpu: 1 },
  { title: "PC · x86_64 (64-bit)", arch: "x86_64", target: "i440fx", memory: 1024, storage: 2, cpu: 1 },
  { title: "ARM64 · virt (64-bit)", arch: "arm64", target: "virt", memory: 512, storage: 2, cpu: 1 },
  { title: "ARM32 · virt (32-bit)", arch: "arm32", target: "virt", memory: 512, storage: 1, cpu: 1 }
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
      notes: "A local v64 PC configuration. Import an ISO, raw disk, floppy image, or Linux bzImage into browser storage and boot it with the vendored v64 runtime.",
      runtime: "local-v64",
      architecture: "x86",
      machine: "i440fx",
      firmware: "seabios",
      memory: 1024,
      cpu: 1,
      storage: 1,
      vgaMemory: 32,
      displayMode: "graphical",
      bootType: "iso",
      bootArguments: "",
      fileRefs: {},
      network: "auto"
    }
  ]
};

let state = loadState();
let transientFiles = new Map();
let runtimeSession = null;
let storageInfo = null;
let busyOperation = false;
let routeAnimationKey = "";
let debugMode = false;
const terminalDecoder = new TextDecoder();
const terminalEncoder = new TextEncoder();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("utm-web-state") || "null");
    if (saved && Array.isArray(saved.vms)) {
      const vms = saved.vms.map(migrateVM).filter(Boolean);
      if (!vms.length) vms.push(...structuredClone(defaults.vms));
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
  try {
    const migrated = UTMRuntime.normalize({ ...structuredClone(defaults.vms[0]), ...vm });
    // Runtime snapshots are not portable across v86 and v64. Keep the file for export.
    if (vm.runtime !== "local-v64" && migrated.fileRefs.state) {
      migrated.fileRefs.state = { ...migrated.fileRefs.state, runtime: "local-v86" };
    }
    migrated.id = String(vm.id || storageId("vm")).replace(/[^A-Za-z0-9_-]/g, "-");
    migrated.name = String(vm.name || "Linux");
    migrated.icon = assets.linux;
    return migrated;
  } catch (error) {
    console.warn("Cannot load VM:", error.message);
    return null;
  }
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
  try {
    const info = await UTMStorage.estimate();
    if (info.quota && file.size > info.quota - (info.usage || 0)) {
      throw new DOMException("This file exceeds the available browser storage.", "QuotaExceededError");
    }
    if (["disk", "disk2"].includes(role) && UTMRuntime.diskFormat(record) === "raw" && UTMStorage.supportsOPFS()) {
      record.url = `opfs:utm-web/disks/${record.id}.img`;
      record.storage = "opfs";
      await UTMStorage.copy(record.url, file);
      delete record.blob;
    }
    await putRecord(record);
    refreshStorageInfo();
    return fileMeta(record);
  } catch (error) {
    if (record.url) await UTMStorage.remove(record.url).catch(() => {});
    if (error.name !== "QuotaExceededError") throw error;
    transientFiles.set(record.id, file);
    showToast("Browser storage is full. This file is available for this tab only; reattach it after reopening the app. Use Download to keep VM snapshots on your device.");
    return { ...fileMeta(record), storage: "temporary", url: undefined };
  }
}

async function storedFile(ref, transientKey) {
  const transient = transientFiles.get(ref?.id) || transientFiles.get(transientKey);
  if (ref?.storage === "opfs") return UTMStorage.file(ref.url);
  if (transient) return transient;
  return ref?.id ? (await getRecord(ref.id))?.blob || null : null;
}

async function removeStoredFile(ref) {
  if (!ref?.id) return;
  if (state.vms.some(vm => Object.values(vm.fileRefs || {}).some(file => file.id === ref.id))) return;
  if (ref.storage === "opfs") await UTMStorage.remove(ref.url);
  await withFileStore("readwrite", store => store.delete(ref.id));
  transientFiles.delete(ref.id);
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
  const file = await storedFile(ref, transientKey);
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
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
  if (state.route.name === "storage") renderStorage();
  renderActionSheet();
  const key = `${state.route.name}:${state.route.page || state.route.pane || state.route.id || ""}`;
  if (key !== routeAnimationKey && state.route.name !== "display") {
    routeAnimationKey = key;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      $("view").animate?.([{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 210, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }
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
    kernel: ".bin,.elf,.img,.gz,.bzimage,.zimage,.image,vmlinuz",
    initrd: ".img,.initrd,.gz",
    disk: ".raw,.img,.qcow2,.vhd,.vdi,.vmdk,.vhdx",
    disk2: ".raw,.img,.qcow2,.vhd,.vdi,.vmdk,.vhdx",
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
      <p class="library-caption">Your machines. On your device.</p>
      <section class="section">
        <div class="group">
          ${state.vms.map(vm => `
            <div class="vm-row ${vm.id === state.selectedId ? "selected" : ""}" role="button" tabindex="0" onclick="libraryTap('${vm.id}')">
              <img src="${escapeHtml(vm.icon)}" alt="">
              <span class="vm-meta">
                <span class="vm-name">${escapeHtml(vm.name)}</span>
                <span class="vm-subtitle">${escapeHtml(vm.architecture)} · ${escapeHtml(vm.status)}</span>
              </span>
              <button class="play-button" onclick="event.stopPropagation(); runVM('${vm.id}')">&#9654;</button>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="section">
        <div class="group">
          ${navRow("Create Linux VM", "sf:plus.circle", "icon-blue", "openWizard()")}
          ${navRow("Import VM Config", "sf:doc", "icon-gray", "showImportConfigSheet()")}
          ${navRow("Install to Home Screen", assets.utm, "", "downloadHomeScreenProfile()", "iPhone / iPad")}
          ${navRow("Browser Storage", "sf:externaldrive", "icon-purple", "openStorage()", storageInfo?.usage ? formatBytes(storageInfo.usage) : "On device")}
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

function downloadHomeScreenProfile() {
  showToast("In Safari, allow the profile download. Then open Settings → Profile Downloaded → Install. The UTM icon opens the published app on your Home Screen.");
  // Explicitly download the same-origin file. Navigating to it can display XML
  // when a static host serves .mobileconfig as text or a generic binary file.
  const link = document.createElement("a");
  link.href = new URL("UTM.mobileconfig", window.location.href).href;
  link.download = "UTM.mobileconfig";
  link.type = "application/x-apple-aspen-config";
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  if (runtimeSession || busyOperation) return;
  const vm = vmById(id);
  try { UTMRuntime.validate(vm); } catch (error) { showToast(error.message); return; }
  state.selectedId = vm.id;
  vm.status = "Starting";
  saveState();
  runtimeSession = {
    vmId: vm.id,
    status: "starting",
    mode: vm.runtime,
    displayMode: vm.displayMode || "serial",
    output: [],
    debug: [],
    debugVisible: false,
    inputCount: 0,
    serialBytes: 0,
    screenSize: "pending",
    mouseEnabled: "unknown",
    bootPromptDetected: false,
    autoBootEnter: false,
    autoBootSent: false,
    keyboardReady: "unknown",
    serialLines: "unknown",
    textGrid: Array.from({ length: 80 }, () => []),
    screenText: "",
    lastScreenLine: "",
    module: null,
    diskPath: "/utm/disk.img",
    diskRef: null,
    startedAt: Date.now()
  };
  window.__utmWebRuntime = runtimeSession;
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
        ${row("Saving", vm.saveOnStop === false ? "Manual snapshots" : "Snapshot on stop")}
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
          ${Object.entries(vm.fileRefs).map(([key, file]) => row(fileTitle(key), `${file.name} · ${formatBytes(file.size)} stored${file.virtualSize ? ` / ${formatBytes(file.virtualSize)} capacity` : ""}${file.storage === "temporary" ? " · This tab only" : ""}`)).join("")}
          ${vm.fileRefs?.disk ? navRow("Download Disk Image", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'disk')`) : ""}
          ${vm.fileRefs?.disk2 ? navRow("Download Second Disk", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'disk2')`) : ""}
          ${vm.fileRefs?.diskExport ? navRow("Download Saved Disk Copy", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'diskExport')`) : ""}
          ${vm.fileRefs?.state ? navRow("Download Save State", "sf:square.and.arrow.down", "icon-green", `downloadAttachedFile('${vm.id}', 'state')`) : ""}
          ${["disk", "disk2"].filter(key => vm.fileRefs?.[key] && diskFormat(vm.fileRefs[key]) === "raw" && !vm.fileRefs.state).map(key => navRow(`Compact ${fileTitle(key)} (QCOW2)`, "sf:externaldrive", "icon-blue", `compactStoredDisk('${vm.id}', '${key}')`)).join("")}
        </div>
        <p class="section-footer">QCOW2 images leave zero-filled blocks out and expand automatically when read by the VM. For a saved VM, use Files while it is running to download a compact or expanded disk including its latest writes.</p>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">v64</p>
      <div class="group">
        ${navRow("Edit VM Settings", "sf:cpu", "icon-orange", `editVM('${vm.id}')`)}
        ${navRow("Copy Launch Config", "sf:doc.on.clipboard", "icon-blue", `copyV86Config('${vm.id}')`)}
        ${navRow("Export Config", "sf:square.and.arrow.down", "icon-green", `exportConfig('${vm.id}')`)}
      </div>
      ${debugMode ? codeBlock(config) : ""}
      <button class="nav-button" onclick="toggleAppDebug()">${debugMode ? "Hide Debug Mode" : "Debug Mode"}</button>
    </section>
    <section class="section">
      <p class="section-title">Notes</p>
      <div class="group"><p class="detail-notes">${escapeHtml(vm.notes)}</p></div>
    </section>
  `;
}

function runtimeLabel(vm) {
  return "Local v64";
}

function networkLabel(vm) {
  if (vm.network === "none" || !vm.network) return "Off";
  if (vm.network === "local" || vm.network === "auto" && UTMRuntime.localRelayAvailable) return "Local NAT · TCP + UDP";
  return "Browser HTTP · limited";
}

async function configureNetwork() {
  UTMRuntime.localRelayAvailable = false;
  if (!window.location) return;
  try {
    const response = await fetch("/utm-local-status.json", { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const status = await response.json();
      UTMRuntime.localRelayAvailable = status.internet === "ethernet";
      UTMRuntime.localNetworkStatus = status;
      if (state.route.name === "library") renderLibrary();
    }
  } catch { /* A plain static server has no TCP relay. */ }
}

function displayLabel(vm) {
  return vm.displayMode === "serial" ? "Serial console" : UTMRuntime.isARM(vm) ? "Virtio GPU" : "VGA display";
}

function bootLabel(vm) {
  if (vm.bootType === "kernel") return UTMRuntime.isARM(vm) ? "Linux Image / zImage" : "Linux bzImage";
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
    disk2: "Second Disk",
    cdrom: "CD/DVD Image",
    floppy: "Floppy Image",
    state: "Save State",
    diskExport: "Saved Disk Copy"
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
  return UTMRuntime.diskFormat(ref);
}

function openWizard() {
  state.wizard = newWizard();
  setRoute({ name: "wizard", page: "start" });
}

function newWizard() {
  return {
    history: [],
    page: "start",
    runtime: "local-v64",
    machineIndex: 1,
    architecture: "x86_64",
    target: "i440fx",
    firmware: "seabios",
    memory: 1024,
    cpu: 1,
    vgaMemory: 32,
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
      <p class="section-title">Architecture</p>
      <div class="group">
        ${selectRow("Machine", supportedMachines[state.wizard.machineIndex].title, supportedMachines.map(machine => machine.title), "chooseMachine(this.selectedIndex)")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Custom</p>
      <div class="group">
        <button class="choice-row" onclick="wizardContinue()">
          ${iconMarkup(assets.linux)}
          <span class="choice-copy"><strong>Linux</strong><span>x86, x64, ARM64 and ARM32 emulation in the browser.</span></span>
          <span class="checkmark">&#10003;</span>
        </button>
      </div>
    </section>
    <section class="section">
      <p class="section-title">Runtime</p>
      <div class="group">
        ${row("Engine", "v64")}
        ${row("Display", "VGA / Virtio GPU + serial")}
        ${row("Acceleration", "WebAssembly JIT")}
        ${row("Network", networkLabel({ network: "auto" }))}
      </div>
    </section>
  `;
}

function wizardBoot() {
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Boot Type", state.wizard.bootType, UTMRuntime.bootTypes(state.wizard), "setWizardValue('bootType', this.value)")}
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
        ${row("Architecture", selected.title)}
        ${selectRow("Board", state.wizard.target, UTMRuntime.machineTypes(state.wizard), "setWizardValue('target', this.value)")}
        ${state.wizard.architecture === "x86_64" ? selectRow("Firmware", state.wizard.firmware, ["seabios", "uefi"], "setWizardValue('firmware', this.value)") : ""}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Display</p>
      <div class="group">
        ${selectRow("Mode", state.wizard.displayMode, ["serial", "graphical"], "setWizardValue('displayMode', this.value)")}
      </div>
      ${state.wizard.displayMode === "graphical" ? `<p class="section-footer">Graphical mode uses VGA on PC and virtio-gpu on ARM. ARM kernels need the virtio-gpu driver; otherwise use the serial console.</p>` : ""}
    </section>
    <section class="section">
      <p class="section-title">Memory</p>
      <div class="group">
        <div class="row">
          <span class="row-title">RAM</span>
          <span class="range-row">
            <input type="range" min="128" max="1536" step="128" value="${state.wizard.memory}" oninput="setWizardSilent('memory', Number(this.value)); this.nextElementSibling.value = this.value">
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
          <input type="number" min="0.0625" step="0.25" value="${state.wizard.storage}" oninput="setWizardSilent('storage', Number(this.value))" aria-label="Blank disk size in GiB">
          <span class="row-value">GiB</span>
        </div>
        ${navRow(state.wizard.fileRefs.disk ? "Disk Attached" : "Create Blank Disk", "sf:externaldrive", "icon-blue", "createBlankDisk('wizard')", state.wizard.fileRefs.disk?.name || "Optional")}
      </div>
      <p class="section-footer">New QCOW2 disks grow as you use them: a 20 GiB capacity does not reserve 20 GiB of browser storage. Save or close the VM to preserve guest writes in a snapshot. Available browser storage still sets the limit.</p>
    </section>
  `;
}

async function createBlankDisk(scope) {
  if (busyOperation) return;
  const target = scope === "wizard" ? state.wizard : state.draft;
  const size = Math.round(Number(target.storage || 2) * 1024 ** 3 / 512) * 512;
  if (!Number.isSafeInteger(size) || size < 16 * 1024 ** 2) { showToast("Choose a disk size of at least 16 MiB."); return; }
  const id = storageId("disk");
  const url = `opfs:utm-web/disks/${id}.qcow2`;
  setBusy("Creating your disk…");
  try {
    const { createBlank } = await import("./disk-images.mjs");
    let ref;
    if (UTMStorage.supportsOPFS()) {
      const file = await UTMStorage.write(url, write => createBlank(size, write));
      const record = { id, role: "disk", name: "Blank Disk.qcow2", size: file.size, virtualSize: size, storage: "opfs", url, savedAt: Date.now() };
      await putRecord(record);
      ref = fileMeta(record);
    } else {
      const chunks = [];
      await createBlank(size, chunk => chunks.push(chunk));
      ref = await importFileToStore(new File(chunks, "Blank Disk.qcow2"), "disk");
      ref.virtualSize = size;
    }
    const previous = target.fileRefs.disk;
    target.fileRefs.disk = ref;
    if (previous) await removeStoredFile(previous).catch(console.warn);
    refreshStorageInfo();
    render();
  } catch (error) { await UTMStorage.remove(url).catch(() => {}); showToast(`Could not create disk: ${error.message}`); }
  finally { setBusy(""); }
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
        ${row("Engine", "v64")}
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
      <p class="section-title">v64</p>
      ${debugMode ? codeBlock(config) : ""}
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
  state.wizard.firmware = "seabios";
  if (UTMRuntime.isARM(state.wizard)) {
    state.wizard.bootType = "kernel";
    state.wizard.displayMode = "serial";
    state.wizard.bootArguments = "console=ttyAMA0";
  } else {
    state.wizard.bootType = "iso";
    state.wizard.displayMode = "graphical";
    state.wizard.bootArguments = "";
  }
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
  setBusy("Importing media…");
  const previous = state.wizard.fileRefs[key];
  try { state.wizard.fileRefs[key] = await importFileToStore(file, key); }
  catch (error) { showToast(`Could not store media: ${error.message}`); return; }
  finally { setBusy(""); }
  transientFiles.set(`wizard:${key}`, file);
  render();
  if (previous) await removeStoredFile(previous).catch(console.warn);
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

async function cancelWizard() {
  if (busyOperation) return;
  const files = Object.values(state.wizard?.fileRefs || {});
  state.wizard = null;
  setRoute({ name: "library" });
  for (const file of files) await removeStoredFile(file).catch(console.warn);
}

function saveWizard() {
  const vm = wizardToVM(storageId("vm"));
  try { UTMRuntime.validate(vm); } catch (error) { showToast(error.message); return; }
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
    notes: "Local browser VM config generated from UTM-Web. Import boot media into browser storage, then run it with the vendored v64 engine.",
    runtime: w.runtime,
    architecture: w.architecture,
    machine: w.target,
    firmware: w.firmware,
    memory: w.memory,
    cpu: w.cpu,
    storage: w.storage,
    vgaMemory: w.vgaMemory,
    displayMode: w.displayMode,
    bootType: w.bootType,
    bootArguments: w.bootArguments,
    fileRefs: structuredClone(w.fileRefs),
    network: "auto"
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
    virtualSize: file.virtualSize,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now(),
    savedAt: file.savedAt || Date.now(),
    storage: file.storage || "indexeddb",
    url: file.url
  };
}

function openSettings() {
  const vm = vmById();
  state.editingId = vm.id;
  state.draft = structuredClone(vm);
  setRoute({ name: "settings" });
}

function editVM(id) {
  state.selectedId = id;
  openSettings();
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
        ${navRow("Network", "sf:network.slash", "icon-green", "openSettingsPane('Network')")}
        ${navRow("v64", "sf:shippingbox", "icon-purple", "openSettingsPane('v64')")}
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
  if (pane === "Network") {
    return `<section class="section">
      <p class="section-title">Internet Access</p>
      <div class="group">${selectRow("Mode", vm.network || "none", ["auto", "none", "browser", "local"], "setDraft('network', this.value); render()")}</div>
      <p class="section-footer">Auto uses local Ethernet NAT for TCP, UDP, DNS and guest HTTPS when the local server and QEMU are available. On GitHub Pages it uses limited browser HTTP. None turns networking off. The guest needs a virtio-net driver and DHCP.</p>
    </section><section class="section"><div class="group">${row("This Session", networkLabel(vm))}</div>
      <p class="section-footer">Run <code>node scripts/serve-local.mjs</code> with QEMU installed. Add <code>--lan</code> to open the site from a PC or phone on your network. Each visiting browser runs its own VM; the server provides files and networking. HTTP LAN addresses support the VM, but OPFS, offline installation and some browser features require a trusted HTTPS origin. NAT does not provide Wi-Fi radio passthrough; incoming services need port forwarding. Remove an old snapshot before adding a network card.</p></section>`;
  }
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
          ${selectRow("Architecture", vm.architecture, UTMRuntime.architectures, "setDraftArchitecture(this.value)")}
          ${selectRow("Machine", vm.machine, UTMRuntime.machineTypes(vm), "setDraft('machine', this.value)")}
          ${vm.architecture === "x86_64" ? selectRow("Firmware", vm.firmware || "seabios", ["seabios", "uefi"], "setDraft('firmware', this.value)") : ""}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Memory</p>
        <div class="group">
          <div class="row">
            <span class="row-title">RAM</span>
            <span class="range-row">
              <input type="range" min="128" max="1536" step="128" value="${vm.memory}" oninput="setDraft('memory', Number(this.value)); this.nextElementSibling.value = this.value">
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
        ${vm.displayMode === "graphical" ? `<p class="section-footer">Graphical mode uses v64's browser screen adapter. Tap the display to focus keyboard and pointer input.</p>` : ""}
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
        <div class="group">${selectRow("Boot Type", vm.bootType, UTMRuntime.bootTypes(vm), "setDraft('bootType', this.value); render()")}</div>
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
          <div class="group">${fileRow("Disk Image", "disk", "draft")}${fileRow("Second Disk", "disk2", "draft")}</div>
          ${vm.bootType === "iso" ? `<p class="section-footer">Optional, but needed if you want the guest to install or save changes to a disk image.</p>` : ""}
        </section>
      <section class="section">
        <p class="section-title">Boot Arguments</p>
        <div class="group">${textInputRow("Append", vm.bootArguments, "setDraft('bootArguments', this.value)")}</div>
      </section>
    `;
  }
  if (pane === "v64") {
    const config = formatV86Config(vm);
    return `
      <section class="section">
        <p class="section-title">Generated Config</p>
        ${debugMode ? codeBlock(config) : '<p class="section-footer">Enable Debug Mode to show the generated boot configuration.</p>'}
        <button class="nav-button" onclick="toggleAppDebug()">${debugMode ? "Hide Debug Mode" : "Debug Mode"}</button>
      </section>
      <section class="section">
        <p class="section-title">Save State</p>
        <div class="group">
          ${toggleRow("Save When Stopping", vm.saveOnStop !== false, "setDraft('saveOnStop', this.checked)")}
          ${vm.fileRefs?.state ? row("State", `${vm.fileRefs.state.name} · ${formatBytes(vm.fileRefs.state.size)}`) : row("State", "None saved")}
          ${fileRow("Restore State", "state", "draft")}
          ${vm.fileRefs?.state ? navRow("Remove Restore State", "sf:trash", "icon-red", "removeDraftState()") : ""}
        </div>
        <p class="section-footer">Stopping saves your place in this browser. RAW disks in browser storage also keep guest writes as they happen. QCOW2 disks grow with actual data; their new writes are kept in snapshots, so leave Save When Stopping enabled. Files in the VM toolbar can download a compact QCOW2 or expanded RAW backup.</p>
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

function removeDraftState() {
  delete state.draft.fileRefs.state;
  transientFiles.delete(`${state.draft.id}:state`);
  render();
}

function setDraftArchitecture(architecture) {
  const vm = state.draft;
  const wasARM = UTMRuntime.isARM(vm);
  vm.architecture = architecture;
  vm.machine = UTMRuntime.isARM(vm) ? "virt" : "i440fx";
  vm.firmware = "seabios";
  if (UTMRuntime.isARM(vm) !== wasARM) {
    vm.bootType = UTMRuntime.isARM(vm) ? "kernel" : "iso";
    vm.bootArguments = UTMRuntime.isARM(vm) ? "console=ttyAMA0" : "";
    vm.displayMode = UTMRuntime.isARM(vm) ? "serial" : "graphical";
  }
  render();
}

function setDraft(key, value) {
  state.draft[key] = value;
}

async function pickDraftFile(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  state.draft.fileRefs = state.draft.fileRefs || {};
  setBusy("Importing media…");
  const previous = state.draft.fileRefs[key];
  try { state.draft.fileRefs[key] = await importFileToStore(file, key); }
  catch (error) { showToast(`Could not store media: ${error.message}`); return; }
  finally { setBusy(""); }
  transientFiles.set(`${state.draft.id}:${key}`, file);
  render();
  if (previous) await removeStoredFile(previous).catch(console.warn);
}

async function saveSettings() {
  try { UTMRuntime.validate(state.draft); } catch (error) { showToast(error.message); return; }
  const index = state.vms.findIndex(vm => vm.id === state.editingId);
  const previous = Object.values(state.vms[index]?.fileRefs || {});
  if (index !== -1) {
    state.vms[index] = structuredClone(state.draft);
    state.selectedId = state.draft.id;
    state.vms[index].status = "Stopped";
  }
  state.draft = null;
  saveState();
  setRoute({ name: "detail", id: state.selectedId });
  for (const ref of previous) await removeStoredFile(ref).catch(console.warn);
  refreshStorageInfo();
}

async function cancelSettings() {
  if (busyOperation) return;
  const files = Object.values(state.draft?.fileRefs || {});
  state.draft = null;
  setRoute({ name: "detail", id: state.selectedId });
  for (const file of files) await removeStoredFile(file).catch(console.warn);
}

function deleteDraftVM() {
  if (!state.draft || state.vms.length <= 1) return;
  state.actionSheet = { title: `Delete ${state.draft.name} and its unshared local files?`, actions: [["Delete VM", "confirmDeleteVM()"]] };
  renderActionSheet();
}

async function confirmDeleteVM() {
  if (!state.draft || state.vms.length <= 1) return;
  const files = Object.values(state.draft.fileRefs || {});
  state.vms = state.vms.filter(vm => vm.id !== state.draft.id);
  state.selectedId = state.vms[0].id;
  state.draft = null;
  saveState();
  setRoute({ name: "library" });
  for (const file of files) await removeStoredFile(file).catch(console.warn);
  refreshStorageInfo();
}

async function refreshStorageInfo() {
  try {
    storageInfo = await UTMStorage.estimate();
    if (state.route.name === "storage") renderStorage();
  } catch (error) { console.warn(error); }
}

function openStorage() {
  setRoute({ name: "storage" });
  refreshStorageInfo();
}

function renderStorage() {
  renderNav("Browser Storage", navButton("&lsaquo; UTM", "setRoute({ name: 'library' })"), navButton("Refresh", "refreshStorageInfo()"));
  const info = storageInfo || {};
  const percent = info.quota ? Math.min(100, (info.usage || 0) / info.quota * 100) : 0;
  $("view").innerHTML = `
    <section class="section storage-intro">
      ${iconMarkup("sf:externaldrive", "icon-purple")}
      <h1>Made to stay local.</h1>
      <p>Your VM files stay on this device, in this browser.</p>
    </section>
    <section class="section">
      <div class="group storage-card">
        ${row("Used", info.usage === undefined ? "Checking…" : formatBytes(info.usage))}
        ${row("Available", info.quota ? formatBytes(Math.max(0, info.quota - (info.usage || 0))) : "Managed by your browser")}
        <progress max="100" value="${percent}" aria-label="Browser storage usage"></progress>
        ${row("Keep Storage", info.persisted ? "Enabled" : "Not granted")}
        ${row("Writable Disks", info.opfs ? "Saved automatically" : "Saved with snapshots")}
        ${navRow("Keep Storage on This Device", "sf:externaldrive", "icon-blue", "requestPersistentStorage()")}
      </div>
      <p class="section-footer">Capacity is shared by this website’s origin and can reach gigabytes. Keep Storage asks the browser to protect it from automatic cleanup. Clearing website data, private browsing, or removing the app can still remove VMs. Download backups you want to keep.</p>
    </section>
    <section class="section">
      <p class="section-title">Your Machines</p>
      <div class="group">${state.vms.map(vm => navRow(vm.name, vm.icon, "", `editVM('${vm.id}')`, formatBytes(Object.values(vm.fileRefs || {}).reduce((sum, ref) => sum + (ref.storage === "temporary" ? 0 : Number(ref.size || 0)), 0)))).join("")}</div>
    </section>`;
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) { showToast("This browser manages storage automatically. Download backups to keep a copy on your device."); return; }
  const granted = await navigator.storage.persist();
  await refreshStorageInfo();
  showToast(granted ? "Storage is protected from automatic cleanup." : "The browser has not granted permanent storage yet. Your files are saved, but keep downloaded backups too.");
}

function setBusy(message) {
  busyOperation = !!message;
  document.querySelector(".operation-banner")?.remove();
  document.querySelectorAll(".floating-toolbar button").forEach(button => { button.disabled = busyOperation; });
  if (!message) return;
  const banner = document.createElement("div");
  banner.className = "operation-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `<span class="progress-spinner"></span><span>${escapeHtml(message)}</span>`;
  $("app").appendChild(banner);
}

function v86ConfigPreview(vm) {
  const files = Object.fromEntries(Object.entries(vm.fileRefs || {}).map(([key, ref]) => [key, { file: ref.name }]));
  try { return UTMRuntime.options(vm, files); }
  catch (error) { return { error: error.message, architecture: vm.architecture }; }
}

function formatV86Config(vm) {
  return JSON.stringify(v86ConfigPreview(vm), null, 2);
}

function buildV86Plan(vm) {
  return { executable: `v64 · ${vm.architecture}`, args: [formatV86Config(vm)] };
}

async function startRuntime(id) {
  const vm = vmById(id);
  const session = runtimeSession;
  if (!session || session.vmId !== id) return;
  appendOutput(`UTM Web ${vm.name}`);
  appendOutput(`Runtime: ${runtimeLabel(vm)}`);
  appendOutput("Engine: v64");
  debugLog(formatV86Config(vm));
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
  if (runtimeSession !== session) return;
  if (!localRuntime) {
    failRuntime(vm, `Local v64 runtime not found at ${v86Runtime.module}.`);
    return;
  }
  try {
    await configureNetwork();
    if (runtimeSession !== session) return;
    appendOutput("Local v64 runtime found in repo.");
    appendOutput("Preparing v64 machine...");
    await startLocalV86(vm, session);
  } catch (error) {
    if (runtimeSession === session) failRuntime(vm, error.message || String(error));
  }
}

function appendOutput(line) {
  if (!runtimeSession) return;
  debugLog(String(line));
  if (!String(line).startsWith("Stopped:")) return;
  runtimeSession.error = String(line);
  runtimeSession.output.push(String(line));
  const output = $("terminalOutput");
  if (output) output.textContent = runtimeSession.output.join("\n");
}

function debugLog(message) {
  if (!runtimeSession) return;
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  runtimeSession.debug.push(`${stamp} ${message}`);
  if (runtimeSession.debug.length > 250) {
    runtimeSession.debug.splice(0, runtimeSession.debug.length - 250);
  }
  updateDebugPanel();
}

function updateDebugPanel() {
  const debug = $("debugOutput");
  if (!debug || !runtimeSession) return;
  debug.textContent = runtimeSession.debug.join("\n");
  debug.scrollTop = debug.scrollHeight;
  const status = $("debugStatus");
  if (status) status.textContent = debugStatusText(runtimeSession);
}

function debugStatusText(session) {
  return [
    `status=${session.status}`,
    `screen=${session.screenSize || "pending"}`,
    `mouse=${session.mouseEnabled}`,
    `serialBytes=${session.serialBytes || 0}`,
    `inputs=${session.inputCount || 0}`,
    `keyboard=${session.keyboardReady}`,
    `serialLines=${session.serialLines}`,
    `bootPrompt=${session.bootPromptDetected ? "yes" : "no"}`,
    `auto=${session.autoBootEnter ? "on" : "off"}`
  ].join("  ");
}

function enableSerialModemLines(emulator = runtimeSession?.emulator) {
  if (!emulator) return;
  try {
    emulator.serial_set_carrier_detect(0, true);
    emulator.serial_set_data_set_ready(0, true);
    emulator.serial_set_clear_to_send(0, true);
    runtimeSession.serialLines = "DCD/DSR/CTS";
    debugLog("serial modem lines enabled: DCD DSR CTS");
  } catch (error) {
    runtimeSession.serialLines = "failed";
    debugLog(`serial modem lines failed: ${error.message || error}`);
  }
}

function appendTerminalBytes(bytes) {
  if (!runtimeSession) return;
  runtimeSession.serialBytes = (runtimeSession.serialBytes || 0) + bytes.length;
  const decoder = runtimeSession.terminalDecoder ||= new TextDecoder();
  const text = decoder.decode(new Uint8Array(bytes), { stream: true });
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
  detectBootPrompt();
}

function detectBootPrompt() {
  if (!runtimeSession) return;
  const tail = runtimeSession.output.slice(-8).join("\n");
  if (!runtimeSession.bootPromptDetected && /(?:^|\n)boot:\s*$/i.test(tail)) {
    runtimeSession.bootPromptDetected = true;
    debugLog("detected ISOLINUX boot prompt");
  }
  if (runtimeSession.bootPromptDetected && runtimeSession.autoBootEnter && !runtimeSession.autoBootSent) {
    runtimeSession.autoBootSent = true;
    debugLog("auto boot enter scheduled");
    setTimeout(() => sendSerialText("\r"), 250);
  }
}

function trimRuntimeOutput() {
  if (!runtimeSession || runtimeSession.output.length <= 1200) return;
  runtimeSession.output.splice(0, runtimeSession.output.length - 1200);
}

function failRuntime(vm, message) {
  if (runtimeSession) {
    runtimeSession.status = "stopped";
    clearTimeout(runtimeSession.startTimer);
    const emulator = runtimeSession.emulator;
    if (emulator) {
      runtimeSession.cancelled = true;
      Promise.resolve(emulator.destroy()).catch(console.warn);
    }
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

async function startLocalV86(vm, session) {
  const payloads = {};
  for (const [key, ref] of Object.entries(vm.fileRefs || {})) {
    if (key !== "state" && !requiredFileKeys(vm).includes(key) && !["disk", "disk2"].includes(key) && !(vm.bootType === "kernel" && key === "initrd")) continue;
    if (["disk", "disk2"].includes(key) && ref.storage === "opfs" && diskFormat(ref) === "raw") {
      payloads[key] = { url: ref.url, size: ref.size, disk_option: "read_write" };
      continue;
    }
    const file = await storedFile(ref, `${vm.id}:${key}`);
    if (runtimeSession !== session) return;
    if (!file) throw new Error(`Stored ${fileTitle(key)} is missing. Re-import the file.`);
    // v64 reads File/Blob descriptors on demand, avoiding a full ISO/disk copy in UI memory.
    payloads[key] = key === "state" ? file : { buffer: file, async: true };
  }
  const missing = requiredFileKeys(vm).filter(key => !payloads[key]);
  if (missing.length) throw new Error(`Missing ${missing.map(fileTitle).join(", ")}.`);
  const screen = $("v86Screen");
  const { V86 } = await import(runtimeUrl(v86Runtime.module));
  if (runtimeSession !== session) return;
  const options = UTMRuntime.options(vm, payloads, runtimeUrl);
  const restoreFile = payloads.state;
  delete options.initial_state;
  options.autostart = !restoreFile;
  options.screen = { container: screen, use_graphical_text: false };
  options.disable_mouse = vm.displayMode === "serial";
  options.disable_keyboard = vm.displayMode === "serial";
  const emulator = new V86(options);
  window.emulator = emulator;
  window.__utmWebRuntime = session;
  session.emulator = emulator;
  session.diskRef = vm.fileRefs.disk;
  session.screenElement = screen;
  session.keyboardReady = emulator.keyboard_adapter ? "yes" : "no";
  debugLog(`v64: ${vm.architecture}/${vm.machine}; ${vm.cpu} core(s); ${vm.memory} MiB`);
  session.startTimer = setTimeout(() => {
    if (runtimeSession === session && session.status === "starting") failRuntime(vm, "Runtime initialization timed out. Check the runtime files and browser console.");
  }, 60000);
  const listen = (name, fn) => emulator.add_listener(name, value => {
    if (runtimeSession === session && !session.cancelled) fn(value);
  });
  listen("emulator-error", error => failRuntime(vm, error?.message || String(error)));
  listen("download-error", error => failRuntime(vm, `Could not load ${error?.file_name || "runtime media"}. Check that all vendor files were deployed.`));
  listen("emulator-ready", async () => {
    try {
      if (restoreFile) {
        appendOutput("Restoring your saved session…");
        await emulator.restore_state_stream(restoreFile);
        if (runtimeSession !== session || session.cancelled) return;
        emulator.run();
      }
      clearTimeout(session.startTimer);
      session.status = "running";
      vm.status = "Running";
      saveState();
      if (!UTMRuntime.isARM(vm)) enableSerialModemLines(emulator);
      appendOutput(`v64 ready · ${vm.architecture} · ${vm.cpu} core(s).`);
      debugLog("event emulator-ready");
      renderDisplay();
    } catch (error) { if (runtimeSession === session) failRuntime(vm, error.message || String(error)); }
  });
  listen("emulator-stopped", () => {
    debugLog("event emulator-stopped");
  });
  listen("screen-set-size", size => {
    session.screenSize = (size || []).join("x");
    [session.guestWidth, session.guestHeight] = size || [];
    fitGUIWindow();
    updateDebugPanel();
  });
  listen("screen-put-char", captureScreenChar);
  listen("mouse-enable", enabled => { session.mouseEnabled = enabled ? "on" : "off"; });
  listen("serial0-output-byte", byte => {
    (session.pendingSerial ||= []).push(byte);
    if (!session.serialTimer) session.serialTimer = setTimeout(() => {
      session.serialTimer = null;
      if (runtimeSession !== session || session.cancelled) return;
      appendTerminalBytes(session.pendingSerial.splice(0));
      updateDebugPanel();
    }, 32);
  });
}

function captureScreenChar(args) {
  if (!runtimeSession || !Array.isArray(args)) return;
  const [row, col, chr] = args;
  if (!Number.isInteger(row) || !Number.isInteger(col)) return;
  if (!runtimeSession.textGrid[row]) runtimeSession.textGrid[row] = [];
  runtimeSession.textGrid[row][col] = chr >= 32 && chr < 127 ? String.fromCharCode(chr) : " ";
  const lines = runtimeSession.textGrid
    .map(cells => cells.join("").trimEnd())
    .filter(Boolean);
  runtimeSession.screenText = lines.slice(-30).join("\n");
  const interesting = lines.find(line => /debian|linux|live|kernel|isolinux|boot|vesamenu|install/i.test(line));
  if (interesting && interesting !== runtimeSession.lastScreenLine) {
    runtimeSession.lastScreenLine = interesting;
    debugLog(`screen: ${interesting}`);
  }
}

function uint8ToArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function runtimeUrl(path) {
  return new URL(path, window.location.href).href;
}

function toggleAppDebug() {
  debugMode = !debugMode;
  render();
}

function renderDisplay() {
  const vm = vmById(state.route.id);
  const session = runtimeSession && runtimeSession.vmId === vm.id ? runtimeSession : {
    status: "stopped", output: ["No active runtime session."], diskRef: null
  };
  renderNav(vm.name, navButton("Stop", "stopDisplay()"), "");
  $("view").className = "view display-view";
  if (session.screenElement && $("v86Screen") === session.screenElement) {
    syncDisplayControls();
    return;
  }
  const mode = vm.displayMode === "graphical" ? "graphical" : "serial";
  $("view").innerHTML = `
    <div id="displaySurface" class="display-surface ${mode}">
      <div id="guiWindow" class="gui-window" aria-label="Resizable virtual machine window">
        <div id="v86Screen" class="v86-screen" tabindex="0" aria-label="Virtual machine display">
          <div class="v86-text"></div><canvas></canvas>
        </div>
        <button id="guiResize" class="gui-resize" aria-label="Resize display: drag or use arrow keys" title="Drag to resize">◢</button>
      </div>
      <pre id="terminalOutput" class="terminal-output" tabindex="0">${escapeHtml(session.output.join("\n"))}</pre>
      <form class="serial-input" onsubmit="sendSerialInput(event)">
        <input id="serialTextInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="send" aria-label="Serial input">
        <button type="submit">RET</button>
      </form>
      <div id="guiKeyboard" class="gui-keyboard" hidden>
        <input id="guiKeyboardInput" type="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-label="Type on the guest keyboard" placeholder="Type in your VM…">
        <div class="guest-keys">
          <button onclick="sendGuestKey('Escape')">Esc</button><button onclick="sendGuestKey('Tab')">Tab</button>
          <button onclick="sendGuestKey('ControlAltDelete')">Ctrl Alt Del</button><button onclick="sendGuestKey('Backspace')">⌫</button>
          <button onclick="sendGuestKey('ArrowLeft')">←</button><button onclick="sendGuestKey('ArrowDown')">↓</button>
          <button onclick="sendGuestKey('ArrowUp')">↑</button><button onclick="sendGuestKey('ArrowRight')">→</button>
          <button onclick="sendGuestKey('Enter')">Return</button>
        </div>
      </div>
      <div class="floating-toolbar">
        <button onclick="saveActiveDisk()" aria-label="Save VM to browser">Save</button>
        <button onclick="showVMDownloads()" aria-label="Download VM files">Files</button>
        <button onclick="toggleGuestKeyboard()" aria-label="Show touch keyboard">Keyboard</button>
        <button onclick="toggleDisplayFullscreen()" aria-label="Enter fullscreen">Fullscreen</button>
        ${mode === "graphical" ? '<button onclick="resetGUIWindow()">Fit</button>' : ''}
        <button onclick="toggleDebugPanel()" id="debugToggle" aria-pressed="false">Debug</button>
        <button onclick="restartDisplay()">Restart</button>
        <button onclick="stopDisplay()">Close</button>
      </div>
      <div class="fullscreen-controls">
        <button onclick="toggleGuestKeyboard()" aria-label="Show touch keyboard">Keyboard</button>
        <button onclick="toggleDisplayFullscreen()" aria-label="Exit fullscreen">Exit Fullscreen</button>
      </div>
      <div class="runtime-chip"></div>
      <div id="debugMount"></div>
    </div>`;
  session.screenElement = $("v86Screen");
  setupV86Input(session.screenElement);
  setupConsoleInput($("terminalOutput"));
  setupGuestKeyboard($("guiKeyboardInput"));
  setupGUIResize($("guiResize"));
  if (typeof ResizeObserver !== "undefined") {
    session.resizeObserver = new ResizeObserver(() => fitGUIWindow());
    session.resizeObserver.observe($("displaySurface"));
  }
  syncDisplayControls();
}

function syncDisplayControls() {
  const session = runtimeSession;
  if (!session) return;
  const vm = vmById(session.vmId);
  $("displaySurface")?.classList.toggle("debug-visible", !!session.debugVisible);
  $("displaySurface")?.classList.toggle("keyboard-visible", !!session.keyboardVisible);
  $("app").classList.toggle("display-fullscreen", !!session.fullscreen);
  const chip = document.querySelector(".runtime-chip");
  if (chip) chip.textContent = session.error || `${session.status} · v64 · ${vm.architecture}`;
  $("debugToggle")?.setAttribute("aria-pressed", String(!!session.debugVisible));
  if ($("debugMount")) $("debugMount").innerHTML = session.debugVisible ? renderDebugPanel(session) : "";
  if ($("guiKeyboard")) $("guiKeyboard").hidden = !session.keyboardVisible || vm.displayMode !== "graphical";
  updateDebugPanel();
  fitGUIWindow();
}

async function toggleDisplayFullscreen() {
  if (!runtimeSession) return;
  const session = runtimeSession;
  session.fullscreen = !session.fullscreen;
  syncDisplayControls();
  try {
    if (session.fullscreen && !document.fullscreenElement) await $("app").requestFullscreen?.();
    else if (!session.fullscreen && document.fullscreenElement) await document.exitFullscreen?.();
  } catch { /* iOS and embedded views use the same viewport-filling CSS fallback. */ }
  fitGUIWindow();
}

function toggleGuestKeyboard() {
  if (!runtimeSession) return;
  if (vmById(runtimeSession.vmId).displayMode === "serial") {
    $("serialTextInput")?.focus();
    return;
  }
  runtimeSession.keyboardVisible = !runtimeSession.keyboardVisible;
  syncDisplayControls();
  if (runtimeSession.keyboardVisible) $("guiKeyboardInput")?.focus();
  else $("guiKeyboardInput")?.blur();
}

function fitGUIWindow() {
  const session = runtimeSession, surface = $("displaySurface"), frame = $("guiWindow");
  if (!session || !surface || !frame) return;
  const bounds = surface.getBoundingClientRect();
  const width = Math.max(1, bounds.width - (session.fullscreen ? 0 : 24));
  const height = Math.max(1, bounds.height - (session.fullscreen ? 0 : 108) - (session.keyboardVisible ? 140 : 0));
  const ratio = (session.guestWidth || 4) / (session.guestHeight || 3);
  const wanted = session.fullscreen ? width : session.windowWidth || width;
  const fittedWidth = Math.min(wanted, width, height * ratio);
  frame.style.width = `${Math.max(1, fittedWidth)}px`;
  frame.style.height = `${Math.max(1, fittedWidth / ratio)}px`;
}

function resetGUIWindow() {
  if (runtimeSession) runtimeSession.windowWidth = null;
  fitGUIWindow();
}

function setupGUIResize(handle) {
  if (!handle) return;
  let drag;
  handle.addEventListener("pointerdown", event => {
    event.preventDefault(); event.stopPropagation();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: $("guiWindow").getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId || !runtimeSession) return;
    const ratio = (runtimeSession.guestWidth || 4) / (runtimeSession.guestHeight || 3);
    runtimeSession.windowWidth = Math.max(160, drag.width + (event.clientX - drag.x) + (event.clientY - drag.y) * ratio);
    fitGUIWindow();
  });
  const end = () => { drag = null; };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
  handle.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || !runtimeSession) return;
    event.preventDefault(); event.stopPropagation();
    const direction = ["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1;
    runtimeSession.windowWidth = Math.max(160, $("guiWindow").getBoundingClientRect().width + direction * 32);
    fitGUIWindow();
  });
}

function setupGuestKeyboard(input) {
  if (!input) return;
  const flush = () => {
    if (input.value && runtimeSession?.emulator) {
      sendKeyboardInput(runtimeSession.emulator, input.value);
      input.value = "";
    }
  };
  input.addEventListener("input", event => { if (!event.isComposing) flush(); });
  input.addEventListener("compositionend", flush);
  input.addEventListener("beforeinput", event => {
    if (event.inputType === "deleteContentBackward") { event.preventDefault(); sendGuestKey("Backspace"); }
    else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") { event.preventDefault(); sendGuestKey("Enter"); }
  });
  input.addEventListener("keydown", event => {
    if (["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !event.isComposing) {
      event.preventDefault(); event.stopPropagation(); sendGuestKey(event.key);
    }
  });
  // Keep the phone keyboard open while tapping the extra guest keys.
  $("guiKeyboard").addEventListener("pointerdown", event => { if (event.target.closest("button")) event.preventDefault(); });
}

function sendGuestKey(key) {
  const keys = { Enter: "\r", Tab: "\t", Escape: "\x1b", Backspace: "\x7f", ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D" };
  const emulator = runtimeSession?.emulator;
  if (!emulator) return;
  if (key === "ControlAltDelete") emulator.keyboard_send_scancodes([0x1D, 0x38, 0xE0, 0x53, 0xE0, 0xD3, 0xB8, 0x9D]);
  else if (keys[key]) sendKeyboardInput(emulator, keys[key]);
}

function renderDebugPanel(session) {
  return `
    <section class="debug-panel">
      <div class="debug-head">
        <strong>v64 Debug</strong>
        <button onclick="toggleDebugPanel()">Close</button>
      </div>
      <p id="debugStatus" class="debug-status">${escapeHtml(debugStatusText(session))}</p>
      <div class="debug-actions">
        <button onclick="sendKeyboardEnter()">Key Enter</button>
        <button onclick="sendScancodeEnter()">Scan Enter</button>
        <button onclick="sendSerialOnly('\r')">Serial Enter</button>
        <button onclick="sendSerialOnly('\n')">Serial LF</button>
        <button onclick="sendSerialOnly('\r\n')">Serial CRLF</button>
        <button onclick="sendSerialText('\r')">Both Enter</button>
        <button onclick="enableSerialModemLines()">Serial Lines</button>
        <button onclick="enableAutoBootEnter()">Auto Boot</button>
        <button onclick="copyDebugLog()">Copy Log</button>
        <button onclick="clearDebugLog()">Clear</button>
      </div>
      <form class="debug-send" onsubmit="sendDebugInput(event)">
        <input id="debugInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="text or boot label">
        <button type="submit">Send Both</button>
      </form>
      <form class="debug-send" onsubmit="sendDebugSerialInput(event)">
        <input id="debugSerialInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="serial label">
        <button type="submit">Serial CRLF</button>
      </form>
      <details><summary>Boot configuration</summary>${codeBlock(formatV86Config(vmById(session.vmId)))}</details>
      <pre id="debugOutput">${escapeHtml((session.debug || []).join("\n"))}</pre>
    </section>
  `;
}

function toggleDebugPanel() {
  if (!runtimeSession) return;
  runtimeSession.debugVisible = !runtimeSession.debugVisible;
  if (runtimeSession.debugVisible) debugLog("debug panel opened");
  renderDisplay();
}

function clearDebugLog() {
  if (!runtimeSession) return;
  runtimeSession.debug = [];
  debugLog("debug log cleared");
}

async function copyDebugLog() {
  const text = runtimeSession?.debug?.join("\n") || "";
  await navigator.clipboard.writeText(text);
  debugLog("debug log copied");
}

function sendDebugInput(event) {
  event.preventDefault();
  const input = $("debugInput");
  const text = input?.value || "";
  if (text) sendSerialText(text);
  sendSerialText("\r");
  if (input) input.value = "";
}

function sendDebugSerialInput(event) {
  event.preventDefault();
  const input = $("debugSerialInput");
  const text = input?.value || "";
  if (text) sendSerialOnly(text);
  sendSerialOnly("\r\n");
  if (input) input.value = "";
}

function enableAutoBootEnter() {
  if (!runtimeSession) return;
  runtimeSession.autoBootEnter = true;
  runtimeSession.autoBootSent = false;
  debugLog("auto boot enter enabled");
  detectBootPrompt();
}

function setupV86Input(screen) {
  if (!screen) return;
  let touch;
  const send = (name, value) => runtimeSession?.emulator?.bus?.send(name, value);
  const position = event => {
    const canvas = screen.querySelector("canvas");
    const rect = (canvas?.getBoundingClientRect().width ? canvas : screen).getBoundingClientRect();
    send("mouse-absolute", [Math.max(0, Math.min(rect.width, event.clientX - rect.left)), Math.max(0, Math.min(rect.height, event.clientY - rect.top)), rect.width, rect.height]);
  };
  screen.addEventListener("pointerdown", event => {
    screen.focus({ preventScroll: true });
    if (event.pointerType !== "touch" || touch) return;
    event.preventDefault();
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    screen.setPointerCapture(event.pointerId);
    position(event);
    send("mouse-click", [true, false, false]);
  });
  screen.addEventListener("pointermove", event => {
    if (!touch || touch.id !== event.pointerId) return;
    event.preventDefault();
    send("mouse-delta", [event.clientX - touch.x, touch.y - event.clientY]);
    position(event);
    touch.x = event.clientX; touch.y = event.clientY;
  });
  const release = event => {
    if (!touch || touch.id !== event.pointerId) return;
    send("mouse-click", [false, false, false]); touch = null;
  };
  screen.addEventListener("pointerup", release);
  screen.addEventListener("pointercancel", release);
  screen.addEventListener("lostpointercapture", release);
  // Pointer events above provide tap/drag for PC and ARM tablet input. Suppress
  // the runtime's legacy touch path to avoid duplicate deltas and synthetic clicks.
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) screen.addEventListener(type, event => {
    event.preventDefault(); event.stopPropagation();
  }, { passive: false });
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
    appendOutput("Serial input skipped: v64 is not ready yet.");
    return;
  }
  runtimeSession.inputCount = (runtimeSession.inputCount || 0) + 1;
  emulator.serial0_send(text);
  debugLog(`serial input ${debugTextLabel(text)}`);
}

function sendRuntimeEnter() {
  if (vmById(runtimeSession?.vmId)?.displayMode === "graphical") sendKeyboardEnter();
  else sendSerialText("\r");
}

function sendSerialOnly(text) {
  const emulator = runtimeSession?.emulator;
  if (!emulator) {
    appendOutput("Serial input skipped: v64 is not ready yet.");
    return;
  }
  runtimeSession.inputCount = (runtimeSession.inputCount || 0) + 1;
  emulator.serial0_send(text);
  debugLog(`input serial ${debugTextLabel(text)}`);
}

function sendKeyboardEnter() {
  const emulator = runtimeSession?.emulator;
  if (!emulator) {
    appendOutput("Keyboard input skipped: v64 is not ready yet.");
    return;
  }
  runtimeSession.inputCount = (runtimeSession.inputCount || 0) + 1;
  emulator.keyboard_send_keys([13]);
  debugLog("input keyboard keyCode Enter");
}

function sendScancodeEnter() {
  const emulator = runtimeSession?.emulator;
  if (!emulator) {
    appendOutput("Scancode input skipped: v64 is not ready yet.");
    return;
  }
  runtimeSession.inputCount = (runtimeSession.inputCount || 0) + 1;
  emulator.keyboard_send_scancodes([0x1C, 0x9C], 10);
  debugLog("input keyboard scancode Enter 0x1C/0x9C");
}

function sendKeyboardInput(emulator, text) {
  const scancodes = {
    "\r": [0x1C, 0x9C],
    "\n": [0x1C, 0x9C],
    "\x7f": [0x0E, 0x8E],
    "\t": [0x0F, 0x8F],
    "\x1b": [0x01, 0x81],
    "\x1b[A": [0xE0, 0x48, 0xE0, 0xC8],
    "\x1b[B": [0xE0, 0x50, 0xE0, 0xD0],
    "\x1b[C": [0xE0, 0x4D, 0xE0, 0xCD],
    "\x1b[D": [0xE0, 0x4B, 0xE0, 0xCB]
  };
  if (scancodes[text]) {
    return emulator.keyboard_send_scancodes(scancodes[text]);
  }
  // Preserve newlines/tabs in pasted text without sending them twice.
  for (const part of text.split(/([\r\n\t\x1b\x7f])/).filter(Boolean)) {
    if (scancodes[part]) emulator.keyboard_send_scancodes(scancodes[part]);
    else emulator.keyboard_send_text(part);
  }
}

function debugTextLabel(text) {
  return JSON.stringify(String(text)
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\x1b", "\\x1b")
    .replaceAll("\x7f", "\\x7f"));
}

async function stopDisplay(skipSave = false) {
  if (busyOperation) return;
  const vm = vmById(state.route.id);
  const session = runtimeSession;
  if (!skipSave && session?.status === "running" && vm.saveOnStop !== false) {
    if (!await saveActiveDisk()) {
      state.actionSheet = { title: "Could not save in browser storage. Download a backup before closing.", actions: [
        ["Download VM Snapshot", "downloadSnapshot()"],
        ["Close Without Saving", "hideSheet(); stopDisplay(true)"]
      ] };
      renderActionSheet();
      return false;
    }
  }
  if (session) {
    session.cancelled = true; clearTimeout(session.startTimer); clearTimeout(session.serialTimer);
    session.resizeObserver?.disconnect();
    if (session.fullscreen && document.fullscreenElement) await document.exitFullscreen?.().catch(() => {});
  }
  $("app").classList.remove("display-fullscreen");
  runtimeSession = null;
  if (session?.emulator) {
    setBusy("Closing your VM…");
    try {
      await session.emulator.stop();
      await session.emulator.destroy();
    } catch (error) {
      console.warn(error);
    } finally { setBusy(""); }
  }
  vm.status = "Stopped";
  runtimeSession = null;
  window.__utmWebRuntime = null;
  window.emulator = null;
  saveState();
  setRoute({ name: "detail", id: vm.id });
  refreshStorageInfo();
  return true;
}

async function restartDisplay() {
  const id = state.route.id;
  if (!await stopDisplay()) return;
  runVM(id);
}

function openURL(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

async function saveActiveDisk() {
  if (busyOperation) return false;
  if (!runtimeSession?.emulator || runtimeSession.status !== "running") {
    appendOutput("Save skipped: v64 is not ready yet.");
    return false;
  }
  const session = runtimeSession;
  const vm = vmById(session.vmId);
  let path;
  setBusy("Saving your VM…");
  try {
    const safeName = vm.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "utm-web";
    let updated;
    if (UTMStorage.supportsOPFS()) {
      const id = storageId("state");
      path = `opfs:utm-web/states/${id}.bin`;
      const file = await UTMStorage.write(path, write => session.emulator.save_state_stream(write));
      const record = { id, name: `${safeName}.v64state.bin`, size: file.size, role: "state", storage: "opfs", url: path, savedAt: Date.now() };
      await putRecord(record);
      updated = fileMeta(record);
    } else {
      const chunks = [];
      await session.emulator.save_state_stream(chunk => { chunks.push(chunk.slice()); });
      updated = await putBytesToStore(`${safeName}.v64state.bin`, "state", new Blob(chunks));
    }
    updated.runtime = "local-v64";
    updated.machineConfig = UTMRuntime.signature(vm);
    const previous = vm.fileRefs?.state;
    vm.fileRefs = vm.fileRefs || {};
    vm.fileRefs.state = updated;
    vm.status = "Saved";
    saveState();
    if (previous) await removeStoredFile(previous).catch(console.warn);
    appendOutput(`Saved v64 state (${formatBytes(updated.size)}) to browser storage.`);
    refreshStorageInfo();
    return true;
  } catch (error) {
    if (path) await UTMStorage.remove(path).catch(() => {});
    appendOutput(`Save failed: ${error.message || error}`);
    state.actionSheet = { title: "Browser storage could not save this VM. You can download it to your device.", actions: [["Download VM Snapshot", "downloadSnapshot()"]] };
    renderActionSheet();
    return false;
  } finally { setBusy(""); }
}

function showVMDownloads() {
  const vm = vmById(runtimeSession?.vmId);
  state.actionSheet = { title: "Save a copy on your device", actions: [
    ["Download VM Snapshot", "downloadSnapshot()"],
    ...(vm.fileRefs?.disk ? [["Download Compact Disk (QCOW2)", "downloadRunningDisk()"], ["Download Expanded Disk (RAW)", "downloadRunningDisk(\'raw\')"]] : []),
    ...(vm.fileRefs?.disk ? [["Save Disk Copy in Browser", "hideSheet(); saveRunningDisk()"]] : []),
    ["Download Launch Config", "exportConfig(); hideSheet()"]
  ] };
  renderActionSheet();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadTarget(name) {
  // Called directly from a tap: the picker keeps the user's activation.
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ suggestedName: name });
    const writer = await handle.createWritable();
    return { write: chunk => writer.write(chunk), finish: () => writer.close(), abort: () => writer.abort() };
  }
  const chunks = [];
  return {
    write: chunk => { chunks.push(chunk.slice()); },
    finish: () => downloadBlob(new Blob(chunks, { type: "application/octet-stream" }), name),
    abort: async () => { chunks.length = 0; }
  };
}

async function downloadRuntimeFile(kind, format = "qcow2") {
  if (busyOperation || runtimeSession?.status !== "running") return;
  const session = runtimeSession;
  const vm = vmById(session.vmId);
  const name = vm.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "utm-web";
  let target;
  try {
    target = await downloadTarget(`${name}.${kind === "state" ? "v64state.bin" : format === "raw" ? "img" : "qcow2"}`);
    hideSheet();
    setBusy(kind === "state" ? "Preparing snapshot download…" : "Preparing disk download…");
    if (kind === "state") await session.emulator.save_state_stream(target.write);
    else await session.emulator.export_disk_image(UTMRuntime.isARM(vm) ? "virtio_disk0" : "hda", { format, write: target.write });
    await target.finish();
    appendOutput("Download prepared. Keep the launch config and original boot media with your backup.");
  } catch (error) {
    if (target) await Promise.resolve(target.abort()).catch(() => {});
    if (error.name !== "AbortError") showToast(`Download failed: ${error.message || error}`);
  } finally { setBusy(""); }
}

function downloadSnapshot() { return downloadRuntimeFile("state"); }
function downloadRunningDisk(format = "qcow2") { return downloadRuntimeFile("disk", format); }

async function saveRunningDisk() {
  const session = runtimeSession;
  if (busyOperation || session?.status !== "running" || !session.diskRef) return;
  const vm = vmById(session.vmId);
  const name = `${vm.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.qcow2`;
  const id = storageId("diskExport"), url = `opfs:utm-web/disks/${id}.qcow2`;
  setBusy("Saving compact disk copy…");
  try {
    let ref;
    const produce = write => session.emulator.export_disk_image(UTMRuntime.isARM(vm) ? "virtio_disk0" : "hda", { format: "qcow2", write });
    if (UTMStorage.supportsOPFS()) {
      const file = await UTMStorage.write(url, produce);
      const record = { id, role: "diskExport", name, size: file.size, storage: "opfs", url, savedAt: Date.now() };
      await putRecord(record);
      ref = fileMeta(record);
    } else {
      const chunks = [];
      await produce(chunk => chunks.push(chunk.slice()));
      const file = new File(chunks, name);
      ref = await importFileToStore(file, "diskExport");
      if (ref.storage === "temporary") { downloadBlob(file, name); transientFiles.delete(ref.id); return; }
    }
    const previous = vm.fileRefs.diskExport;
    vm.fileRefs.diskExport = ref;
    saveState();
    if (previous) await removeStoredFile(previous).catch(console.warn);
    refreshStorageInfo();
    showToast("Compact disk copy saved. Download it from Attached Media after closing the VM.");
  } catch (error) {
    await UTMStorage.remove(url).catch(() => {});
    state.actionSheet = { title: "Browser storage could not save the disk copy. Download it instead.", actions: [["Download Compact Disk", "downloadRunningDisk()"]] };
    renderActionSheet();
  } finally { setBusy(""); }
}

async function compactStoredDisk(id, key = "disk", download = false) {
  if (busyOperation || runtimeSession) return;
  const vm = vmById(id), previous = vm.fileRefs?.[key];
  // A snapshot can contain disk writes and references to the original image.
  // Never silently detach it or replace the image it needs.
  if (!previous || vm.fileRefs.state || diskFormat(previous) !== "raw") {
    showToast("Run this VM and use Files → Download Compact Disk to include saved guest writes.");
    return;
  }
  const name = previous.name.replace(/\.[^.]+$/, "") + ".qcow2";
  const recordId = storageId(key), url = `opfs:utm-web/disks/${recordId}.qcow2`;
  let target, committed = false;
  try {
    if (download) target = await downloadTarget(name);
    hideSheet();
    setBusy("Compacting disk…");
    const file = await storedFile(previous, `${id}:${key}`);
    if (!file) throw new Error("The original disk is missing.");
    const { compactRaw } = await import("./disk-images.mjs");
    const progress = ({ phase, loaded, total }) => setBusy(`${phase === "scan" ? "Scanning" : "Compacting"} disk… ${Math.round(loaded / total * 100)}%`);
    if (download) {
      await compactRaw(file, target.write, progress);
      await target.finish();
      return;
    }
    let ref;
    if (UTMStorage.supportsOPFS()) {
      const compacted = await UTMStorage.write(url, write => compactRaw(file, write, progress));
      const record = { id: recordId, role: key, name, size: compacted.size, virtualSize: file.size, storage: "opfs", url, savedAt: Date.now() };
      await putRecord(record);
      ref = fileMeta(record);
    } else {
      const chunks = [];
      await compactRaw(file, chunk => chunks.push(chunk), progress);
      const compacted = new File(chunks, name);
      ref = await importFileToStore(compacted, key);
      if (ref.storage === "temporary") { downloadBlob(compacted, name); transientFiles.delete(ref.id); return; }
      ref.virtualSize = file.size;
    }
    vm.fileRefs[key] = ref;
    try { saveState(); } catch (error) { vm.fileRefs[key] = previous; await removeStoredFile(ref).catch(console.warn); throw error; }
    committed = true;
    await removeStoredFile(previous).catch(console.warn);
    refreshStorageInfo();
    render();
    showToast(`Disk compacted: ${formatBytes(previous.size)} → ${formatBytes(ref.size)}. Guest capacity is unchanged.`);
  } catch (error) {
    if (target) await Promise.resolve(target.abort()).catch(() => {});
    if (committed) { showToast("The compact disk was saved. Reopen the VM details to refresh the display."); return; }
    await UTMStorage.remove(url).catch(() => {});
    if (error.name === "AbortError") return;
    state.actionSheet = { title: `Could not compact in browser storage: ${error.message}. The original disk is intact.`, actions: [["Download Compact Disk Instead", `compactStoredDisk('${id}', '${key}', true)`]] };
    renderActionSheet();
  } finally { setBusy(""); }
}

async function copyV86Config(id = state.selectedId) {
  const vm = vmById(id);
  await navigator.clipboard.writeText(formatV86Config(vm));
  showToast("v64 config copied");
}

async function copyDraftV86Config() {
  await navigator.clipboard.writeText(formatV86Config(state.draft));
  showToast("v64 config copied");
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
    version: 2,
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
  try {
    const file = await storedFile(ref, `${vm.id}:${key}`);
    if (!file) { showToast("Stored file is missing"); return; }
    downloadBlob(file, ref.name || `${key}.img`);
  } catch (error) { showToast(`Could not download file: ${error.message}`); }
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
    title: "v64 Runtime",
    actions: [
      ["Open Upstream Repository", `openURL('${v86Runtime.upstream}'); hideSheet()`],
      ["Enable Isolation Headers", "enableIsolation()"],
      ["Disable Isolation Headers", "disableIsolation()"],
      ["Run Runtime Verification", "openURL('tests/browser.html'); hideSheet()"],
      ["Open Local Runtime Notes", `openURL('${v86Runtime.docs}'); hideSheet()`]
    ]
  };
  renderActionSheet();
}

function showImportConfigSheet() {
  state.actionSheet = {
    title: "Import a VM",
    custom: `
      <div class="sheet-import">
        <p>Import a UTM-Web launch configuration. Reattach its original boot media if it came from another browser.</p>
        <label class="import-option">Choose Config<input type="file" accept="application/json,.json,.utmweb" onchange="importConfig(this)"></label>
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
    const source = parsed.vm || parsed;
    const vm = migrateVM(source);
    if (!vm) throw new Error("Unsupported VM config");
    UTMRuntime.validate({ ...vm, fileRefs: { ...vm.fileRefs, state: undefined } });
    vm.id = storageId("vm");
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
  await Promise.all(registrations.filter(registration => new URL(registration.scope).pathname === new URL("./", window.location.href).pathname).map(registration => registration.unregister()));
  window.location.reload();
}

async function ensureIsolation() {
  if (localStorage.getItem("utm-web-disable-isolation") === "1") return;
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  // Refresh even when an existing worker already provides isolation headers;
  // it also supplies the profile download headers that Pages cannot configure.
  await registerIsolationWorker();
  if (crossOriginIsolated) {
    sessionStorage.removeItem("utm-web-isolation-reload");
    return;
  }
  if (!navigator.serviceWorker.controller) {
    await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  }
  if (!crossOriginIsolated && !sessionStorage.getItem("utm-web-isolation-reload")) {
    sessionStorage.setItem("utm-web-isolation-reload", "1");
    window.location.reload();
  }
}

function registerIsolationWorker() {
  return navigator.serviceWorker.register("coi-serviceworker.js?v=v64-20261103-install2", {
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
refreshStorageInfo();
configureNetwork();

window.addEventListener?.("storage", event => {
  if (event.key !== "utm-web-state" || !event.newValue) return;
  try {
    const saved = JSON.parse(event.newValue);
    if (!Array.isArray(saved.vms) || !saved.vms.length) return;
    const active = runtimeSession ? vmById(runtimeSession.vmId) : null;
    state.vms = saved.vms.map(vm => vm.id === active?.id ? active : migrateVM(vm)).filter(Boolean);
    if (active && !state.vms.some(vm => vm.id === active.id)) state.vms.push(active);
    if (!state.vms.some(vm => vm.id === state.selectedId)) state.selectedId = state.vms[0].id;
    if (["library", "storage"].includes(state.route.name)) render();
  } catch (error) { console.warn(error); }
});

// Native Escape and the browser's fullscreen exit must also restore app controls.
document.addEventListener?.("fullscreenchange", () => {
  if (!runtimeSession || document.fullscreenElement) return;
  runtimeSession.fullscreen = false;
  syncDisplayControls();
});
window.addEventListener?.("keydown", event => {
  if (event.key === "Escape" && runtimeSession?.fullscreen) { event.preventDefault(); toggleDisplayFullscreen(); }
});
window.visualViewport?.addEventListener("resize", () => {
  const viewport = window.visualViewport;
  const surface = $("displaySurface"), view = $("view");
  if (surface && view) surface.style.height = `${Math.max(1, Math.min(view.getBoundingClientRect().height, viewport.height + viewport.offsetTop - view.getBoundingClientRect().top))}px`;
  fitGUIWindow();
});
