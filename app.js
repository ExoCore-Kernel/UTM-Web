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
  demoUrl: "https://ktock.github.io/qemu-wasm-demo/alpine-x86_64.html",
  localModule: "vendor/qemu-wasm/qemu-system-x86_64.js",
  docs: "vendor/qemu-wasm/README.md"
};

const supportedMachines = [
  { title: "Intel ICH9 based PC (Q35, x86_64)", arch: "x86_64", target: "q35", memory: 512, storage: 1, cpu: 1 },
  { title: "Intel i440FX based PC (i386)", arch: "i386", target: "pc", memory: 256, storage: 1, cpu: 1 }
];

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
      notes: "A real QEMU-WASM launch target using ktock's hosted Alpine x86_64 demo. It boots in the browser as a terminal VM.",
      runtime: "hosted-demo",
      architecture: "x86_64",
      machine: "pc",
      memory: 512,
      cpu: 1,
      storage: 1,
      bootType: "packaged-demo",
      bootArguments: "console=ttyS0 root=/dev/vda noautodetect hostname=demo",
      fileRefs: {},
      qemuArgs: [],
      network: "fetch-proxy-demo"
    },
    {
      id: "linux-custom",
      name: "Custom Linux",
      os: "Linux",
      status: "Needs Runtime",
      icon: assets.linux,
      notes: "A local QEMU-WASM configuration. Add kernel/initrd/disk images, then drop the generated QEMU-WASM files into vendor/qemu-wasm to boot it here.",
      runtime: "local-qemu-wasm",
      architecture: "x86_64",
      machine: "q35",
      memory: 512,
      cpu: 1,
      storage: 2,
      bootType: "kernel",
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
  if (vm.runtime === "hosted-demo") return structuredClone(defaults.vms[0]);
  if (vm.runtime === "local-qemu-wasm") {
    return {
      ...structuredClone(defaults.vms[1]),
      ...vm,
      os: "Linux",
      runtime: "local-qemu-wasm",
      status: "Needs Runtime",
      fileRefs: vm.fileRefs || {}
    };
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
      bootArguments: vm.bootArguments || "console=ttyS0 root=/dev/vda rw",
      fileRefs: {},
      status: "Needs Runtime"
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
      <input class="fake-file" type="file" onchange="${action}">
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
    output: [],
    iframeUrl: "",
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
  if (vm.runtime === "hosted-demo") return "QEMU-WASM hosted demo";
  return "Local QEMU-WASM";
}

function networkLabel(vm) {
  if (vm.network === "fetch-proxy-demo") return "Demo HTTP proxy";
  return "None";
}

function bootLabel(vm) {
  if (vm.bootType === "packaged-demo") return "Packaged Alpine image";
  if (vm.bootType === "kernel") return "Linux kernel + disk";
  return "Disk image";
}

function requiredFileKeys(vm) {
  if (vm.runtime === "hosted-demo") return [];
  if (vm.bootType === "kernel") return ["kernel", "disk"];
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
    bootType: "kernel",
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
        ${selectRow("Boot Type", state.wizard.bootType, ["kernel", "disk"], "setWizardValue('bootType', this.value)")}
      </div>
    </section>
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
      <p class="section-title">Storage</p>
      <div class="group">${fileRow("Disk Image", "disk")}</div>
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

function pickWizardFile(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  state.wizard.fileRefs[key] = fileMeta(file);
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
    status: "Needs Runtime",
    icon: assets.linux,
    notes: "Local browser VM config generated from UTM-Web. Attach QEMU-WASM runtime files to boot it.",
    runtime: w.runtime,
    architecture: w.architecture,
    machine: w.target,
    memory: w.memory,
    cpu: w.cpu,
    storage: w.storage,
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
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now()
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
        ${navRow("Boot", "sf:externaldrive", "icon-yellow", "openSettingsPane('Boot')")}
        ${navRow("QEMU", "sf:shippingbox", "icon-purple", "openSettingsPane('QEMU')")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Runtime</p>
      <div class="group">
        ${row("Engine", runtimeLabel(vm))}
        ${row("Display", "Serial console")}
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
  if (pane === "Boot") {
    return `
      <section class="section">
        <div class="group">${selectRow("Boot Type", vm.bootType, ["packaged-demo", "kernel", "disk"], "setDraft('bootType', this.value)")}</div>
      </section>
      ${vm.runtime === "hosted-demo" ? `
        <section class="section">
          <p class="section-title">Packaged Demo</p>
          <div class="group">${row("Image", "Alpine Linux x86_64")}</div>
        </section>
      ` : `
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
          <p class="section-title">Disk</p>
          <div class="group">${fileRow("Disk Image", "disk", "draft")}</div>
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

function pickDraftFile(key, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  state.draft.fileRefs = state.draft.fileRefs || {};
  state.draft.fileRefs[key] = fileMeta(file);
  transientFiles.set(`${state.draft.id}:${key}`, file);
  render();
}

function saveSettings() {
  const index = state.vms.findIndex(vm => vm.id === state.editingId);
  if (index !== -1) {
    state.vms[index] = structuredClone(state.draft);
    state.selectedId = state.draft.id;
    state.vms[index].status = state.vms[index].runtime === "hosted-demo" ? "Ready" : "Needs Runtime";
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
  if (vm.runtime === "hosted-demo") {
    return {
      executable: "qemu-system-x86_64",
      args: [
        "-nographic", "-M", "pc", "-m", "512M", "-accel", "tcg,tb-size=500",
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
    "-nographic",
    "-M", vm.machine || "q35",
    "-m", `${vm.memory || 512}M`,
    "-accel", "tcg,tb-size=500",
    "-smp", String(Math.max(1, Number(vm.cpu || 1))),
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
  if (vm.fileRefs?.disk) {
    args.push("-drive", "id=utm0,file=/utm/disk.img,format=raw,if=none");
    args.push("-device", "virtio-blk-pci,drive=utm0");
  }
  if (Array.isArray(vm.qemuArgs) && vm.qemuArgs.length) {
    args.push(...vm.qemuArgs);
  }
  return { executable: vm.architecture === "i386" ? "qemu-system-i386" : "qemu-system-x86_64", args };
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
  if (vm.runtime === "hosted-demo") {
    session.status = "running";
    session.iframeUrl = qemuWasm.demoUrl;
    vm.status = "Running";
    saveState();
    appendOutput("Opening hosted QEMU-WASM Alpine demo...");
    render();
    return;
  }
  const missingFiles = requiredFileKeys(vm).filter(key => !vm.fileRefs?.[key]);
  if (missingFiles.length) {
    failRuntime(vm, `Missing ${missingFiles.map(fileTitle).join(", ")}.`);
    return;
  }
  const localRuntime = await resourceExists(qemuWasm.localModule);
  if (!localRuntime) {
    failRuntime(vm, `Local QEMU-WASM runtime not found at ${qemuWasm.localModule}.`);
    return;
  }
  try {
    session.status = "running";
    vm.status = "Running";
    saveState();
    appendOutput("Local runtime found. Preparing transient browser files...");
    await startLocalQemu(vm);
  } catch (error) {
    failRuntime(vm, error.message || String(error));
  }
}

function appendOutput(line) {
  if (!runtimeSession) return;
  runtimeSession.output.push(String(line));
  const output = $("terminalOutput");
  if (output) {
    output.textContent = runtimeSession.output.join("\n");
    output.scrollTop = output.scrollHeight;
  }
}

function failRuntime(vm, message) {
  if (runtimeSession) {
    runtimeSession.status = "stopped";
    appendOutput(`Stopped: ${message}`);
  }
  vm.status = vm.runtime === "hosted-demo" ? "Ready" : "Needs Runtime";
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
    const file = transientFiles.get(`${vm.id}:${key}`);
    if (file) payloads[key] = new Uint8Array(await file.arrayBuffer());
  }
  const missingRuntimeFiles = requiredFileKeys(vm).filter(key => !payloads[key]);
  if (missingRuntimeFiles.length) {
    throw new Error(`Reselect ${missingRuntimeFiles.map(fileTitle).join(", ")} after page reload.`);
  }
  const previousModule = window.Module;
  window.Module = {
    arguments: plan.args,
    print: appendOutput,
    printErr: line => appendOutput(line),
    preRun: [mod => {
      mod.FS.mkdir("/utm");
      if (payloads.kernel) mod.FS.writeFile("/utm/kernel", payloads.kernel);
      if (payloads.initrd) mod.FS.writeFile("/utm/initrd", payloads.initrd);
      if (payloads.disk) mod.FS.writeFile("/utm/disk.img", payloads.disk);
    }],
    onExit: code => appendOutput(`QEMU exited with code ${code}.`)
  };
  try {
    const module = await import(`./${qemuWasm.localModule}`);
    if (typeof module.default === "function") {
      await module.default(window.Module);
    }
  } catch (error) {
    await loadClassicScript(qemuWasm.localModule);
  } finally {
    if (previousModule) window.Module = previousModule;
  }
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
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
    iframeUrl: ""
  };
  $("view").className = "view display-view";
  const plan = buildQemuPlan(vm);
  $("view").innerHTML = `
    <div class="display-surface">
      ${session.iframeUrl ? `<iframe class="runtime-frame" src="${escapeHtml(session.iframeUrl)}" title="${escapeHtml(vm.name)}"></iframe>` : ""}
      <pre id="terminalOutput" class="terminal-output">${escapeHtml(session.output.join("\n"))}</pre>
      <div class="floating-toolbar">
        <button onclick="restartDisplay()">RST</button>
        <button onclick="copyQemuArgs('${vm.id}')">ARG</button>
        <button onclick="stopDisplay()">X</button>
      </div>
      <div class="runtime-chip">${escapeHtml(session.status)} · ${escapeHtml(plan.executable)}</div>
    </div>
  `;
  const output = $("terminalOutput");
  if (output) output.scrollTop = output.scrollHeight;
}

function stopDisplay() {
  const vm = vmById(state.route.id);
  vm.status = vm.runtime === "hosted-demo" ? "Ready" : "Stopped";
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
      ["Open QEMU-WASM Demo", `openURL('${qemuWasm.demoUrl}'); hideSheet()`],
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
    vm.status = vm.runtime === "hosted-demo" ? "Ready" : "Needs Runtime";
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
  if (!("serviceWorker" in navigator)) {
    showToast("Service workers unavailable");
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map(registration => registration.unregister()));
  window.location.reload();
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

render();
