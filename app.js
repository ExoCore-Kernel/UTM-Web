/*
  UTM Web interactive UI port.
  Source references:
  - UTM-main/Platform/iOS/VMWizardView.swift
  - UTM-main/Platform/Shared/VMWizardStartView.swift
  - UTM-main/Platform/Shared/VMWizardOS*.swift
  - UTM-main/Platform/Shared/VMWizardHardwareView.swift
  - UTM-main/Platform/Shared/VMWizardDrivesView.swift
  - UTM-main/Platform/Shared/VMWizardSharingView.swift
  - UTM-main/Platform/Shared/VMWizardSummaryView.swift
  - UTM-main/Platform/iOS/VMSettingsView.swift
  - UTM-main/Platform/Shared/VMConfig*.swift
  - UTM-main/Platform/iOS/VMToolbarView.swift
*/

const assets = {
  utm: "assets/utm-icon.png",
  screen: "assets/screen.png",
  screenMac: "assets/screenmac.png",
  windows: "assets/windows.png",
  windowsXp: "assets/windows-xp.png",
  linux: "assets/linux.png",
  ubuntu: "assets/ubuntu.png",
  macos: "assets/macos.png",
  logoWindows: "assets/logo-windows.png",
  logoLinux: "assets/logo-linux.png",
  logoMacOS: "assets/logo-macos.png",
  debian: "assets/debian.png",
  other: "assets/freebsd.png",
  keyboard: "assets/Assets.xcassets/Keyboard Paste.imageset/doc.on.clipboard@3x.png",
  keyboardHide: "assets/Assets.xcassets/Keyboard Hide.imageset/chevron.down@3x.png",
  usb: "assets/Assets.xcassets/Toolbar USB.imageset/usb-cable@3x.png",
  menuBar: "assets/Assets.xcassets/MenuBarExtra.imageset/icon_16pt@2x.png",
  drive: "assets/utm-icon.png"
};

const machines = {
  Windows: [
    { title: "Intel i440FX based PC (1996, i386)", arch: "i386", target: "pc-i440fx-10.0", memory: 512, storage: 2, cpu: 1, legacy: true },
    { title: "Intel ICH9 based PC (2009, x86_64)", arch: "x86_64", target: "q35", memory: 512, storage: 2, cpu: 0, legacy: false },
    { title: "ARM64 virtual machine (2014, ARM64)", arch: "aarch64", target: "virt", memory: 512, storage: 2, cpu: 0, legacy: false }
  ],
  Linux: [
    { title: "Intel ICH9 based PC (2009, x86_64)", arch: "x86_64", target: "q35", memory: 512, storage: 2, cpu: 0, legacy: false },
    { title: "ARM64 virtual machine (2014, ARM64)", arch: "aarch64", target: "virt", memory: 512, storage: 2, cpu: 0, legacy: false },
    { title: "RISC-V64 virtual machine (2018, RISC-V64)", arch: "riscv64", target: "virt", memory: 512, storage: 2, cpu: 0, legacy: false }
  ],
  "Classic Mac OS": [
    { title: "Power Macintosh G4 (1999, PPC)", arch: "ppc", target: "mac99", memory: 512, storage: 2, cpu: 1, legacy: true },
    { title: "Macintosh Quadra 800 (1993, M68K)", arch: "m68k", target: "q800", memory: 128, storage: 2, cpu: 1, legacy: true }
  ],
  Other: [
    { title: "Intel ICH9 based PC (2009, x86_64)", arch: "x86_64", target: "q35", memory: 512, storage: 2, cpu: 0, legacy: false },
    { title: "Intel i440FX based PC (1996, i386)", arch: "i386", target: "pc-i440fx-10.0", memory: 512, storage: 2, cpu: 1, legacy: true },
    { title: "ARM64 virtual machine (2014, ARM64)", arch: "aarch64", target: "virt", memory: 512, storage: 2, cpu: 0, legacy: false }
  ]
};

const defaults = {
  route: { name: "library" },
  selectedId: "winxp",
  editingId: null,
  draft: null,
  actionSheet: null,
  wizard: null,
  keyboard: false,
  vms: [
    {
      id: "winxp",
      name: "Windows XP",
      os: "Windows",
      status: "Stopped",
      icon: assets.windowsXp,
      screenshot: assets.screen,
      notes: "Windows XP test machine with SPICE display, shared networking, USB passthrough, and removable media controls.",
      engine: "QEMU",
      useVirtualization: false,
      architecture: "i386",
      machine: "pc-i440fx-10.0",
      memory: 512,
      cpu: 1,
      storage: 8,
      legacyHardware: true,
      bootDevice: "CD/DVD Image",
      bootImage: "Windows XP.iso",
      uefi: false,
      tpm: false,
      guestTools: false,
      sharingDirectory: "",
      sharingReadOnly: false,
      display: { hardware: "VGA", dynamicResolution: true, upscaling: "Linear", downscaling: "Linear", retina: false },
      network: { mode: "Emulated VLAN", hardware: "rtl8139", mac: "52:54:00:12:34:56", portForward: "tcp *:3389 : *:3389" },
      sound: { hardware: "intel-hda", enabled: true },
      input: { usb: true, tablet: true },
      drives: ["IDE Drive", "CD/DVD Drive"],
      serials: ["Serial"],
      displays: ["Display"],
      networks: ["Network"],
      sounds: ["Sound"]
    },
    {
      id: "ubuntu",
      name: "Ubuntu 24.04",
      os: "Linux",
      status: "Suspended",
      icon: assets.ubuntu,
      screenshot: assets.screen,
      notes: "Linux VM configured with QEMU, virtio display, shared networking, and a 16 GiB disk.",
      engine: "QEMU",
      useVirtualization: false,
      architecture: "x86_64",
      machine: "q35",
      memory: 2048,
      cpu: 2,
      storage: 16,
      legacyHardware: false,
      bootDevice: "Boot from ISO image",
      bootImage: "ubuntu-24.04.iso",
      uefi: true,
      tpm: false,
      guestTools: false,
      sharingDirectory: "",
      sharingReadOnly: false,
      display: { hardware: "virtio-vga-gl", dynamicResolution: true, upscaling: "Linear", downscaling: "Linear", retina: true },
      network: { mode: "Shared Network", hardware: "virtio-net-pci", mac: "52:54:00:aa:bb:cc", portForward: "" },
      sound: { hardware: "intel-hda", enabled: true },
      input: { usb: true, tablet: true },
      drives: ["VirtIO Drive", "CD/DVD Drive"],
      serials: ["Serial"],
      displays: ["Display"],
      networks: ["Network"],
      sounds: ["Sound"]
    }
  ]
};

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("utm-web-state") || "null");
    if (saved && Array.isArray(saved.vms)) {
      return { ...structuredClone(defaults), ...saved, route: { name: "library" }, actionSheet: null, wizard: null };
    }
  } catch (error) {
    console.warn(error);
  }
  return structuredClone(defaults);
}

function saveState() {
  const safe = {
    selectedId: state.selectedId,
    vms: state.vms
  };
  localStorage.setItem("utm-web-state", JSON.stringify(safe));
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

function iconForOS(os) {
  if (os === "Windows") return assets.windows;
  if (os === "Linux") return assets.linux;
  if (os === "Classic Mac OS") return assets.macos;
  return assets.other;
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
    "arrow.down.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v9M8.5 12.5 12 16l3.5-3.5"/></svg>`,
    "book.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M8 8.5h3.3c1 0 1.7.6 1.7 1.5v5.5c0-.9-.7-1.5-1.7-1.5H8zM16 8.5h-3.3c-1 0-1.7.6-1.7 1.5v5.5c0-.9.7-1.5 1.7-1.5H16z"/></svg>`,
    "questionmark.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1 1-1 1.8M12 16.5v.1"/></svg>`,
    "doc": `<svg viewBox="0 0 24 24"><path d="M7 4.5h6l4 4V19H7z"/><path d="M13 4.5v4h4"/></svg>`,
    "arrow.down.doc": `<svg viewBox="0 0 24 24"><path d="M7 4.5h6l4 4V19H7z"/><path d="M13 4.5v4h4M12 9.5v6M9.5 13 12 15.5 14.5 13"/></svg>`,
    "info.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8v.1"/></svg>`,
    "cpu": `<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/></svg>`,
    "shippingbox": `<svg viewBox="0 0 24 24"><path d="M5 8.5 12 5l7 3.5v7L12 19l-7-3.5z"/><path d="M5 8.5 12 12l7-3.5M12 12v7"/></svg>`,
    "keyboard": `<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="10" rx="2"/><path d="M7 10h.1M10 10h.1M13 10h.1M16 10h.1M7 13h.1M10 13h4M17 13h.1"/></svg>`,
    "person.crop.circle": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="10" r="2.4"/><path d="M7.5 17c.8-2.1 2.3-3.2 4.5-3.2s3.7 1.1 4.5 3.2"/></svg>`,
    "rectangle.on.rectangle": `<svg viewBox="0 0 24 24"><rect x="7" y="6" width="11" height="8" rx="1.5"/><rect x="4" y="10" width="11" height="8" rx="1.5"/></svg>`,
    "rectangle.connected.to.line.below": `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="8" rx="1.5"/><path d="M12 13v5M8 18h8"/></svg>`,
    "network": `<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M12 8v3.5M12 11.5 7 15M12 11.5 17 15"/></svg>`,
    "speaker.wave.2": `<svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7l-4 3z"/><path d="M15 9.5c1.2 1.4 1.2 3.6 0 5M17.5 7c2.5 2.8 2.5 7.2 0 10"/></svg>`,
    "externaldrive": `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="14" rx="2"/><path d="M9 15h6M12 8v3"/></svg>`,
    "gearshape": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3.8v2.1M12 18.1v2.1M4.9 7.9l1.8 1M17.3 15.1l1.8 1M4.9 16.1l1.8-1M17.3 8.9l1.8-1M3.8 12h2.1M18.1 12h2.1"/></svg>`,
    "link": `<svg viewBox="0 0 24 24"><path d="M10.5 8.5 12 7a4 4 0 0 1 5.7 5.7l-1.5 1.5M13.5 15.5 12 17a4 4 0 0 1-5.7-5.7l1.5-1.5M9.5 14.5l5-5"/></svg>`,
    "hare": `<svg viewBox="0 0 24 24"><path d="M5 16c2-4 5-5 9-4l3-6 1 6c1.3.5 2 1.5 2 3 0 2-1.8 3-4.5 3H8c-1.7 0-2.7-.7-3-2z"/><path d="M9 18l-2 2M15 18l2 2"/></svg>`,
    "tortoise": `<svg viewBox="0 0 24 24"><path d="M5 15c.5-4 3.3-6 7-6s6.5 2 7 6H5z"/><path d="M19 13h2M5 13H3M8 15l-1.5 2M16 15l1.5 2M10 9V7M14 9V7"/></svg>`
  };
  return icons[name] || icons["gearshape"];
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

function fileRow(title, key) {
  return `
    <label class="row">
      <span class="row-title">${escapeHtml(title)}</span>
      <input class="fake-file" type="file" onchange="fakePickFile('${key}', this)">
      <button class="file-button" type="button" onclick="this.previousElementSibling.click()">
        <span class="row-value">${escapeHtml(state.wizard[key] || "Browse...")}</span>
        <span class="chevron">&rsaquo;</span>
      </button>
    </label>
  `;
}

function renderLibrary() {
  $("view").className = "view library-view";
  renderNav(
    "UTM",
    `${navButton("+", "openWizard()", "strong")} ${navButton("Donate", "showDonate()")}`,
    `${navButton("Settings", "showAppSettings()")} ${navButton("Edit", "showEditSheet()")}`
  );
  const list = `
    <div class="library-list">
      <h1 class="large-title">UTM</h1>
      <section class="section">
        <div class="group">
          ${state.vms.map(vm => `
            <div class="vm-row ${vm.id === state.selectedId ? "selected" : ""}" role="button" tabindex="0" onclick="libraryTap('${vm.id}')">
              <img src="${vm.icon}" alt="">
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
          ${navRow("Create a New Virtual Machine", "sf:plus.circle", "icon-blue", "openWizard()")}
          ${navRow("Browse UTM Gallery", "sf:arrow.down.circle", "icon-green", "showGallery()")}
          ${navRow("User Guide", "sf:book.circle", "icon-purple", "showGuide()")}
          ${navRow("Support", "sf:questionmark.circle", "icon-gray", "showSupport()")}
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

function openVM(id) {
  state.selectedId = id;
  setRoute({ name: "detail", id });
}

function runVM(id = state.selectedId) {
  state.selectedId = id;
  const vm = vmById(id);
  vm.status = "Running";
  saveState();
  setRoute({ name: "display", id });
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

function renderDetailBody(vm, isInline = false) {
  return `
    <section class="preview">
      <img src="${vm.screenshot}" alt="">
      <button class="big-play" onclick="runVM('${vm.id}')">&#9654;</button>
    </section>
    <section class="section">
      <div class="group">
        ${row("Status", vm.status)}
        ${row("Architecture", vm.architecture)}
        ${row("Machine", vm.machine)}
        ${row("Memory", `${vm.memory} MiB`)}
        ${row("Size", `${vm.storage} GiB`)}
        ${row("Network", `${vm.network.mode} (${vm.network.hardware})`)}
        ${row("MAC Address", vm.network.mac)}
        ${vm.network.portForward ? row("Port Forward", vm.network.portForward) : ""}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Notes</p>
      <div class="group"><p class="detail-notes">${escapeHtml(vm.notes)}</p></div>
    </section>
    <section class="section">
      <p class="section-title">Removable Drives</p>
      <div class="group">
        ${vm.drives.map(drive => navRow(drive, "sf:externaldrive", "icon-yellow", "showDriveSheet()")).join("")}
      </div>
    </section>
  `;
}

function openWizard() {
  state.wizard = newWizard();
  setRoute({ name: "wizard", page: "start" });
}

function newWizard() {
  return {
    history: [],
    page: "start",
    useVirtualization: true,
    os: "Windows",
    bootDevice: "CD/DVD Image",
    bootImage: "",
    linuxKernel: "",
    linuxInitialRamdisk: "",
    linuxRootImage: "",
    linuxBootArguments: "",
    isWindows10OrHigher: false,
    uefi: false,
    tpm: false,
    guestTools: false,
    expertMode: false,
    machineIndex: 1,
    architecture: "x86_64",
    target: "q35",
    memory: 512,
    cpu: 0,
    storage: 2,
    legacyHardware: false,
    displayOutput: true,
    gl: false,
    sharingDirectory: "",
    sharingReadOnly: false,
    name: ""
  };
}

function wizardTitle(page = state.route.page) {
  return {
    start: "Start",
    os: "Operating System",
    windows: "Windows",
    linux: "Linux",
    classic: "Classic Mac OS",
    other: "Other",
    hardware: "Hardware",
    storage: "Storage",
    sharing: "Shared Directory",
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
  if (page === "os") return wizardOS();
  if (page === "windows") return wizardWindows();
  if (page === "linux") return wizardLinux();
  if (page === "classic") return wizardClassic();
  if (page === "other") return wizardOther();
  if (page === "hardware") return wizardHardware();
  if (page === "storage") return wizardStorage();
  if (page === "sharing") return wizardSharing();
  if (page === "summary") return wizardSummary();
  return "";
}

function wizardStart() {
  return `
    <section class="section">
      <p class="section-title">Custom</p>
      <div class="group">
        <button class="choice-row" onclick="setWizardValue('useVirtualization', true); wizardContinue()">
          ${iconMarkup("sf:hare", "icon-blue")}
          <span class="choice-copy"><strong>Virtualize</strong><span>Faster, but can only run the native CPU architecture.</span></span>
        </button>
        <button class="choice-row" onclick="setWizardValue('useVirtualization', false); wizardContinue()">
          ${iconMarkup("sf:tortoise", "icon-orange")}
          <span class="choice-copy"><strong>Emulate</strong><span>Slower, but can run other CPU architectures.</span></span>
        </button>
      </div>
    </section>
    <section class="section">
      <p class="section-title">Existing</p>
      <div class="group">
        ${navRow("Open...", "sf:doc", "icon-gray", "showOpenSheet()")}
        ${navRow("Download prebuilt from UTM Gallery...", "sf:arrow.down.doc", "icon-green", "showGallery()")}
      </div>
    </section>
  `;
}

function wizardOS() {
  return `
    <section class="section">
      <p class="section-title">Preconfigured</p>
      <div class="group">
        ${osChoice("Classic Mac OS", assets.logoMacOS)}
        ${osChoice("Windows", assets.logoWindows)}
        ${osChoice("Linux", assets.logoLinux)}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Custom</p>
      <div class="group">
        <button class="choice-row" onclick="chooseOS('Other')">
          ${iconMarkup("sf:gearshape", "icon-gray")}
          <span class="choice-copy"><strong>Other</strong></span>
          ${state.wizard.os === "Other" ? `<span class="checkmark">&#10003;</span>` : ""}
        </button>
      </div>
    </section>
  `;
}

function osChoice(name, icon) {
  const checked = state.wizard.os === name ? `<span class="checkmark">&#10003;</span>` : "";
  return `
    <button class="choice-row" onclick="chooseOS('${name}')">
      <img class="os-icon" src="${icon}" alt="">
      <span class="choice-copy"><strong>${escapeHtml(name)}</strong></span>
      ${checked}
    </button>
  `;
}

function wizardWindows() {
  return `
    <section class="section">
      <p class="section-title">Image File Type</p>
      <div class="group">
        ${toggleRow("Install Windows 10 or higher", state.wizard.isWindows10OrHigher, "toggleWindows10(this.checked)")}
        ${navRow("Windows Install Guide", "sf:link", "icon-blue", "showGuide()")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Boot ISO Image</p>
      <div class="group">${fileRow("Boot ISO Image", "bootImage")}</div>
    </section>
    <section class="section">
      <p class="section-title">Options</p>
      <div class="group">
        ${toggleRow("UEFI Boot", state.wizard.uefi, "setWizardValue('uefi', this.checked)")}
        ${toggleRow("Secure Boot with TPM 2.0", state.wizard.tpm, "setWizardValue('tpm', this.checked)")}
        ${toggleRow("Install drivers and SPICE tools", state.wizard.guestTools, "setWizardValue('guestTools', this.checked)")}
      </div>
    </section>
  `;
}

function wizardLinux() {
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Boot Image Type", state.wizard.bootDevice, ["Boot from kernel image", "Boot from ISO image", "Import existing drive"], "setWizardValue('bootDevice', this.value)")}
        ${navRow("Ubuntu Install Guide", "sf:link", "icon-blue", "showGuide()")}
      </div>
    </section>
    ${state.wizard.bootDevice === "Boot from kernel image" ? `
      <section class="section">
        <p class="section-title">Linux kernel (required)</p>
        <div class="group">${fileRow("Kernel", "linuxKernel")}</div>
      </section>
      <section class="section">
        <p class="section-title">Linux initial ramdisk (optional)</p>
        <div class="group">${fileRow("Initial Ramdisk", "linuxInitialRamdisk")}</div>
      </section>
      <section class="section">
        <p class="section-title">Linux Root FS Image (optional)</p>
        <div class="group">${fileRow("Root Image", "linuxRootImage")}</div>
      </section>
      <section class="section">
        <p class="section-title">Boot Arguments</p>
        <div class="group">${textInputRow("Boot Arguments", state.wizard.linuxBootArguments, "setWizardSilent('linuxBootArguments', this.value)")}</div>
      </section>
    ` : `
      <section class="section">
        <p class="section-title">${state.wizard.bootDevice === "Import existing drive" ? "Import Disk Image" : "Boot ISO Image"}</p>
        <div class="group">${fileRow(state.wizard.bootDevice === "Import existing drive" ? "Disk Image" : "Boot ISO Image", "bootImage")}</div>
      </section>
    `}
  `;
}

function wizardClassic() {
  return `
    <section class="section">
      <p class="section-title">Boot ISO Image</p>
      <div class="group">${fileRow("Boot ISO Image", "bootImage")}</div>
    </section>
    <section class="section">
      <p class="section-title">Advanced Options</p>
      <div class="group">
        ${selectRow("PMU", state.wizard.machineProperties || "PMU", ["PMU", "PMU-ADB", "CUDA"], "setWizardValue('machineProperties', this.value)")}
      </div>
    </section>
  `;
}

function wizardOther() {
  return `
    <section class="section">
      <div class="group">
        ${selectRow("Boot Device", state.wizard.bootDevice, ["None", "CD/DVD Image", "Floppy Image", "Drive Image"], "setWizardValue('bootDevice', this.value)")}
      </div>
    </section>
    ${state.wizard.bootDevice !== "None" ? `
      <section class="section">
        <p class="section-title">${state.wizard.bootDevice === "Drive Image" ? "Import Disk Image" : state.wizard.bootDevice === "Floppy Image" ? "Boot IMG Image" : "Boot ISO Image"}</p>
        <div class="group">${fileRow("Image", "bootImage")}</div>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">Options</p>
      <div class="group">${toggleRow("UEFI Boot", state.wizard.uefi, "setWizardValue('uefi', this.checked)")}</div>
    </section>
  `;
}

function wizardHardware() {
  const available = machines[state.wizard.os] || machines.Other;
  const selected = available[state.wizard.machineIndex] || available[0];
  return `
    <section class="section">
      <div class="group">
        ${!state.wizard.useVirtualization ? toggleRow("Expert Mode", state.wizard.expertMode, "setWizardValue('expertMode', this.checked)") : ""}
        ${selectRow("Machine", selected.title, available.map(machine => machine.title), "chooseMachine(this.selectedIndex)")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Memory</p>
      <div class="group">
        <div class="row">
          <span class="row-title">RAM</span>
          <span class="range-row">
            <input type="range" min="128" max="8192" step="128" value="${state.wizard.memory}" oninput="setWizardSilent('memory', Number(this.value)); this.nextElementSibling.value = this.value">
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
            <span>${state.wizard.cpu || "Default"}</span>
            <button onclick="stepWizard('cpu', 1)">+</button>
          </span>
        </div>
      </div>
    </section>
    ${state.wizard.os === "Linux" ? `
      <section class="section">
        <p class="section-title">Display Output</p>
        <div class="group">
          ${toggleRow("Enable display output", state.wizard.displayOutput, "setWizardValue('displayOutput', this.checked)")}
          ${toggleRow("Enable hardware OpenGL acceleration", state.wizard.gl, "setWizardValue('gl', this.checked)")}
        </div>
        <p class="section-footer">There are known issues in some newer Linux drivers including black screen, broken compositing, and apps failing to render.</p>
      </section>
    ` : ""}
    <section class="section">
      <p class="section-title">Options</p>
      <div class="group">${toggleRow("Legacy Hardware", state.wizard.legacyHardware, "setWizardValue('legacyHardware', this.checked)")}</div>
    </section>
  `;
}

function wizardStorage() {
  return `
    <section class="section">
      <p class="section-title">Size</p>
      <div class="group">
        <div class="row">
          <span class="row-title">Specify the size of the drive where data will be stored into.</span>
          <input type="number" value="${state.wizard.storage}" oninput="setWizardSilent('storage', Number(this.value))">
          <span class="row-value">GiB</span>
        </div>
      </div>
    </section>
  `;
}

function wizardSharing() {
  return `
    <section class="section">
      <p class="section-title">Shared Directory Path</p>
      <div class="group">
        ${fileRow("Directory", "sharingDirectory")}
        ${toggleRow("Share is read only", state.wizard.sharingReadOnly, "setWizardValue('sharingReadOnly', this.checked)")}
      </div>
      <p class="section-footer">Optionally select a directory to make accessible inside the VM. Support varies by guest operating system.</p>
    </section>
  `;
}

function wizardSummary() {
  const name = state.wizard.name || defaultNameForOS(state.wizard.os);
  return `
    <section class="section">
      <p class="section-title">Information</p>
      <div class="group">${textInputRow("Name", name, "setWizardSilent('name', this.value)")}</div>
    </section>
    <section class="section">
      <p class="section-title">System</p>
      <div class="group">
        ${row("Engine", state.wizard.useVirtualization ? "Apple Virtualization" : "QEMU")}
        ${row("Use Virtualization", state.wizard.useVirtualization ? "On" : "Off")}
        ${row("Legacy Hardware", state.wizard.legacyHardware ? "On" : "Off")}
        ${row("Architecture", state.wizard.architecture)}
        ${row("System", state.wizard.target)}
        ${row("RAM", `${state.wizard.memory} MiB`)}
        ${row("CPU", state.wizard.cpu ? `${state.wizard.cpu} Cores` : "Default Cores")}
        ${row("Storage", `${state.wizard.storage} GiB`)}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Boot</p>
      <div class="group">
        ${row("Operating System", state.wizard.os)}
        ${row("Boot Image", state.wizard.bootImage || "None")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Sharing</p>
      <div class="group">
        ${row("Share Directory", state.wizard.sharingDirectory ? "On" : "Off")}
        ${state.wizard.sharingDirectory ? row("Directory", state.wizard.sharingDirectory) : ""}
        ${row("Read Only", state.wizard.sharingReadOnly ? "On" : "Off")}
      </div>
    </section>
  `;
}

function defaultNameForOS(os) {
  let base = os === "Other" ? "Virtual Machine" : os;
  let count = state.vms.filter(vm => vm.name.startsWith(base)).length;
  return count ? `${base} ${count + 1}` : base;
}

function chooseOS(os) {
  state.wizard.os = os;
  state.wizard.guestTools = os === "Windows";
  state.wizard.bootDevice = os === "Linux" ? "Boot from ISO image" : os === "Other" ? "CD/DVD Image" : "CD/DVD Image";
  state.wizard.machineIndex = os === "Windows" ? 1 : 0;
  applySelectedMachine();
  wizardContinue();
}

function applySelectedMachine() {
  const available = machines[state.wizard.os] || machines.Other;
  const machine = available[state.wizard.machineIndex] || available[0];
  state.wizard.architecture = machine.arch;
  state.wizard.target = machine.target;
  state.wizard.memory = machine.memory;
  state.wizard.storage = machine.storage;
  state.wizard.cpu = machine.cpu;
  state.wizard.legacyHardware = machine.legacy;
}

function chooseMachine(index) {
  state.wizard.machineIndex = Number(index);
  applySelectedMachine();
  render();
}

function toggleWindows10(value) {
  state.wizard.isWindows10OrHigher = value;
  state.wizard.uefi = value;
  state.wizard.tpm = value;
  state.wizard.guestTools = value;
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
  state.wizard[key] = Math.max(0, Number(state.wizard[key] || 0) + delta);
  render();
}

function fakePickFile(key, input) {
  const file = input.files && input.files[0];
  if (file) {
    state.wizard[key] = file.name;
  }
  render();
}

function wizardNextPage(page = state.route.page) {
  if (page === "start") return "os";
  if (page === "os") {
    if (state.wizard.os === "Windows") return "windows";
    if (state.wizard.os === "Linux") return "linux";
    if (state.wizard.os === "Classic Mac OS") return "classic";
    return "other";
  }
  if (["windows", "linux", "classic", "other"].includes(page)) return "hardware";
  if (page === "hardware") return "storage";
  if (page === "storage") return "sharing";
  if (page === "sharing") return "summary";
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
  const w = state.wizard;
  const id = `vm-${Date.now()}`;
  const newVM = {
    id,
    name: w.name || defaultNameForOS(w.os),
    os: w.os,
    status: "Stopped",
    icon: iconForOS(w.os),
    screenshot: assets.screen,
    notes: "",
    engine: w.useVirtualization ? "Apple Virtualization" : "QEMU",
    useVirtualization: w.useVirtualization,
    architecture: w.architecture,
    machine: w.target,
    memory: w.memory,
    cpu: w.cpu,
    storage: w.storage,
    legacyHardware: w.legacyHardware,
    bootDevice: w.bootDevice,
    bootImage: w.bootImage,
    uefi: w.uefi,
    tpm: w.tpm,
    guestTools: w.guestTools,
    sharingDirectory: w.sharingDirectory,
    sharingReadOnly: w.sharingReadOnly,
    display: { hardware: w.gl ? "virtio-vga-gl" : "virtio-vga", dynamicResolution: true, upscaling: "Linear", downscaling: "Linear", retina: false },
    network: { mode: "Shared Network", hardware: "virtio-net-pci", mac: randomMac(), portForward: "" },
    sound: { hardware: "intel-hda", enabled: true },
    input: { usb: true, tablet: true },
    drives: ["VirtIO Drive", "CD/DVD Drive"],
    serials: ["Serial"],
    displays: ["Display"],
    networks: ["Network"],
    sounds: ["Sound"]
  };
  state.vms.push(newVM);
  state.selectedId = id;
  state.wizard = null;
  saveState();
  setRoute({ name: "detail", id });
}

function randomMac() {
  const bytes = ["52", "54", "00"];
  while (bytes.length < 6) {
    bytes.push(Math.floor(Math.random() * 256).toString(16).padStart(2, "0"));
  }
  return bytes.join(":");
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
    `${navButton("New...", "showAddDeviceSheet()")} ${navButton("Edit", "showEditSheet()")}`,
    `${navButton("Cancel", "cancelSettings()")} ${navButton("Save", "saveSettings()", "strong")}`
  );
  $("view").innerHTML = `
    <section class="section">
      <div class="group">
        ${navRow("Information", "sf:info.circle", "icon-blue", "openSettingsPane('Information')")}
        ${navRow("System", "sf:cpu", "icon-orange", "openSettingsPane('System')")}
        ${navRow("QEMU", "sf:shippingbox", "icon-purple", "openSettingsPane('QEMU')")}
        ${navRow("Input", "sf:keyboard", "icon-gray", "openSettingsPane('Input')")}
        ${navRow("Sharing", "sf:person.crop.circle", "icon-blue", "openSettingsPane('Sharing')")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Devices</p>
      <div class="group">
        ${vm.displays.map((_, index) => navRow("Display", "sf:rectangle.on.rectangle", "icon-green", `openSettingsPane('Display', ${index})`)).join("")}
        ${vm.serials.map((_, index) => navRow("Serial", "sf:rectangle.connected.to.line.below", "icon-green", `openSettingsPane('Serial', ${index})`)).join("")}
        ${vm.networks.map((_, index) => navRow("Network", "sf:network", "icon-green", `openSettingsPane('Network', ${index})`)).join("")}
        ${vm.sounds.map((_, index) => navRow("Sound", "sf:speaker.wave.2", "icon-green", `openSettingsPane('Sound', ${index})`)).join("")}
      </div>
    </section>
    <section class="section">
      <p class="section-title">Drives</p>
      <div class="group">
        ${vm.drives.map((drive, index) => navRow(drive, "sf:externaldrive", "icon-yellow", `openSettingsPane('Drive', ${index})`)).join("")}
        <button class="nav-row" onclick="addDrive('Imported Drive')"><span class="row-title">Import Drive...</span></button>
        <button class="nav-row" onclick="addDrive('New Drive')"><span class="row-title">New Drive...</span></button>
      </div>
    </section>
  `;
}

function openSettingsPane(pane, index = 0) {
  setRoute({ name: "settingsPane", pane, index });
}

function renderSettingsPane() {
  const pane = state.route.pane;
  renderNav(
    pane,
    navButton("&lsaquo; Settings", "setRoute({ name: 'settings' })"),
    navButton("Save", "saveSettings()", "strong")
  );
  $("view").innerHTML = settingsPaneContent(pane, state.route.index);
}

function settingsPaneContent(pane, index) {
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
      <section class="section">
        <p class="section-title">Icon</p>
        <div class="group">
          ${selectRow("Style", vm.os, ["Windows", "Linux", "Classic Mac OS", "Other"], "setDraftOS(this.value)")}
        </div>
      </section>
    `;
  }
  if (pane === "System") {
    return `
      <section class="section">
        <p class="section-title">Hardware</p>
        <div class="group">
          ${selectRow("Architecture", vm.architecture, ["i386", "x86_64", "aarch64", "riscv64", "ppc", "m68k"], "setDraft('architecture', this.value)")}
          ${textInputRow("System", vm.machine, "setDraft('machine', this.value)")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Memory</p>
        <div class="group">
          <div class="row">
            <span class="row-title">RAM</span>
            <span class="range-row">
              <input type="range" min="128" max="8192" step="128" value="${vm.memory}" oninput="setDraft('memory', Number(this.value)); this.nextElementSibling.value = this.value">
              <input type="number" value="${vm.memory}" oninput="setDraft('memory', Number(this.value))">
            </span>
          </div>
        </div>
      </section>
      <section class="section">
        <p class="section-title">CPU</p>
        <div class="group">
          ${textInputRow("CPU", vm.cpu, "setDraft('cpu', Number(this.value))", "number")}
          ${toggleRow("Force Multicore", Boolean(vm.cpu > 1), "setForceMulticore(this.checked)")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Options</p>
        <div class="group">
          ${toggleRow("Legacy Hardware", vm.legacyHardware, "setDraft('legacyHardware', this.checked)")}
          ${toggleRow("UEFI Boot", vm.uefi, "setDraft('uefi', this.checked)")}
          ${toggleRow("Secure Boot with TPM 2.0", vm.tpm, "setDraft('tpm', this.checked)")}
        </div>
      </section>
    `;
  }
  if (pane === "QEMU") {
    return `
      <section class="section">
        <p class="section-title">Arguments</p>
        <div class="group">
          ${row("Generated Arguments", "-machine " + vm.machine)}
          ${textInputRow("Additional Arguments", vm.qemuArgs || "", "setDraft('qemuArgs', this.value)")}
        </div>
      </section>
    `;
  }
  if (pane === "Input") {
    return `
      <section class="section">
        <div class="group">
          ${toggleRow("USB Support", vm.input.usb, "setNestedDraft('input', 'usb', this.checked)")}
          ${toggleRow("Tablet Mode", vm.input.tablet, "setNestedDraft('input', 'tablet', this.checked)")}
        </div>
      </section>
    `;
  }
  if (pane === "Sharing") {
    return `
      <section class="section">
        <p class="section-title">Shared Directory</p>
        <div class="group">
          ${textInputRow("Directory", vm.sharingDirectory, "setDraft('sharingDirectory', this.value)")}
          ${toggleRow("Read Only", vm.sharingReadOnly, "setDraft('sharingReadOnly', this.checked)")}
        </div>
      </section>
    `;
  }
  if (pane === "Display") {
    return `
      <section class="section">
        <p class="section-title">Hardware</p>
        <div class="group">
          ${selectRow("Emulated Display Card", vm.display.hardware, ["VGA", "virtio-vga", "virtio-vga-gl", "vmware-svga"], "setNestedDraft('display', 'hardware', this.value)")}
          ${toggleRow("GPU Acceleration Supported", vm.display.hardware.includes("gl"), "")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Auto Resolution</p>
        <div class="group">${toggleRow("Resize display to screen size and orientation automatically", vm.display.dynamicResolution, "setNestedDraft('display', 'dynamicResolution', this.checked)")}</div>
        <p class="section-footer">Requires SPICE guest agent tools to be installed.</p>
      </section>
      <section class="section">
        <p class="section-title">Scaling</p>
        <div class="group">
          ${selectRow("Upscaling", vm.display.upscaling, ["Nearest", "Linear"], "setNestedDraft('display', 'upscaling', this.value)")}
          ${selectRow("Downscaling", vm.display.downscaling, ["Nearest", "Linear"], "setNestedDraft('display', 'downscaling', this.value)")}
          ${toggleRow("Retina Mode", vm.display.retina, "setNestedDraft('display', 'retina', this.checked)")}
        </div>
      </section>
    `;
  }
  if (pane === "Network") {
    return `
      <section class="section">
        <p class="section-title">Hardware</p>
        <div class="group">
          ${selectRow("Network Mode", vm.network.mode, ["Shared Network", "Emulated VLAN", "Host Only"], "setNestedDraft('network', 'mode', this.value)")}
          ${selectRow("Emulated Network Card", vm.network.hardware, ["rtl8139", "virtio-net-pci", "e1000"], "setNestedDraft('network', 'hardware', this.value)")}
          ${textInputRow("MAC Address", vm.network.mac, "setNestedDraft('network', 'mac', this.value)")}
        </div>
      </section>
      <section class="section">
        <p class="section-title">Port Forward</p>
        <div class="group">${textInputRow("Rule", vm.network.portForward, "setNestedDraft('network', 'portForward', this.value)")}</div>
      </section>
    `;
  }
  if (pane === "Sound") {
    return `
      <section class="section">
        <div class="group">
          ${toggleRow("Enabled", vm.sound.enabled, "setNestedDraft('sound', 'enabled', this.checked)")}
          ${selectRow("Emulated Sound Card", vm.sound.hardware, ["intel-hda", "ich9-intel-hda", "ac97"], "setNestedDraft('sound', 'hardware', this.value)")}
        </div>
      </section>
    `;
  }
  if (pane === "Serial") {
    return `<section class="section"><div class="group">${selectRow("Mode", "Built-in Terminal", ["Built-in Terminal", "TCP Client", "TCP Server"], "")}</div></section>`;
  }
  if (pane === "Drive") {
    return `
      <section class="section">
        <p class="section-title">Image</p>
        <div class="group">
          ${textInputRow("Name", vm.drives[index] || "Drive", `setDriveName(${index}, this.value)`)}
          ${selectRow("Interface", "VirtIO", ["VirtIO", "IDE", "SCSI", "USB"], "")}
          ${selectRow("Image Type", "Disk", ["Disk", "CD/DVD", "BIOS"], "")}
        </div>
      </section>
    `;
  }
  return `<section class="section"><div class="group">${row("No Settings", "")}</div></section>`;
}

function setDraft(key, value) {
  state.draft[key] = value;
}

function setNestedDraft(group, key, value) {
  state.draft[group][key] = value;
}

function setDraftOS(os) {
  state.draft.os = os;
  state.draft.icon = iconForOS(os);
  render();
}

function setDriveName(index, value) {
  state.draft.drives[index] = value;
}

function setForceMulticore(checked) {
  state.draft.cpu = checked ? Math.max(2, state.draft.cpu || 2) : 1;
}

function addDrive(name) {
  state.draft.drives.push(name);
  render();
}

function addDevice(type) {
  if (type === "Display") state.draft.displays.push("Display");
  if (type === "Serial") state.draft.serials.push("Serial");
  if (type === "Network") state.draft.networks.push("Network");
  if (type === "Sound") state.draft.sounds.push("Sound");
  if (type === "Import Drive") state.draft.drives.push("Imported Drive");
  if (type === "New Drive") state.draft.drives.push("New Drive");
  state.actionSheet = null;
  render();
}

function saveSettings() {
  const index = state.vms.findIndex(vm => vm.id === state.editingId);
  if (index >= 0) {
    state.vms[index] = structuredClone(state.draft);
    state.selectedId = state.vms[index].id;
  }
  state.draft = null;
  state.editingId = null;
  saveState();
  setRoute({ name: "detail", id: state.selectedId });
}

function cancelSettings() {
  state.draft = null;
  state.editingId = null;
  setRoute({ name: "detail", id: state.selectedId });
}

function renderDisplay() {
  const vm = vmById(state.route.id);
  $("nav").innerHTML = "";
  $("view").innerHTML = `
    <section class="display-view">
      <img src="${assets.screenMac}" alt="">
      <div class="floating-toolbar">
        <button onclick="stopDisplay()">PWR</button>
        <button onclick="pauseDisplay()">II</button>
        <button onclick="restartDisplay()">RST</button>
        <button onclick="toggleKeyboard()">KBD</button>
        <button onclick="setRoute({ name: 'detail', id: '${vm.id}' })">X</button>
      </div>
      <div class="keyboard-bar ${state.keyboard ? "" : "hidden"}">
        <button>esc</button><button>tab</button><button>ctrl</button><button>alt</button><button>cmd</button><button>fn</button><button onclick="toggleKeyboard()">hide</button>
      </div>
    </section>
  `;
}

function stopDisplay() {
  const vm = vmById();
  vm.status = "Stopped";
  saveState();
  setRoute({ name: "detail", id: vm.id });
}

function pauseDisplay() {
  const vm = vmById();
  vm.status = vm.status === "Running" ? "Paused" : "Running";
  saveState();
  render();
}

function restartDisplay() {
  const vm = vmById();
  vm.status = "Running";
  render();
}

function toggleKeyboard() {
  state.keyboard = !state.keyboard;
  render();
}

function showAddDeviceSheet() {
  state.actionSheet = {
    title: "New...",
    actions: [
      ["Display", "addDevice('Display')"],
      ["Serial", "addDevice('Serial')"],
      ["Network", "addDevice('Network')"],
      ["Sound", "addDevice('Sound')"],
      ["Import Drive...", "addDevice('Import Drive')"],
      ["New Drive...", "addDevice('New Drive')"]
    ]
  };
  renderActionSheet();
}

function showDonate() {
  state.actionSheet = { title: "Donate", actions: [["OK", "hideSheet()"]] };
  renderActionSheet();
}

function showEditSheet() {
  state.actionSheet = { title: "Edit", actions: [["Done", "hideSheet()"]] };
  renderActionSheet();
}

function showGallery() {
  state.actionSheet = { title: "Browse UTM Gallery", actions: [["Close", "hideSheet()"]] };
  renderActionSheet();
}

function showGuide() {
  state.actionSheet = { title: "User Guide", actions: [["Close", "hideSheet()"]] };
  renderActionSheet();
}

function showSupport() {
  state.actionSheet = { title: "Support", actions: [["Close", "hideSheet()"]] };
  renderActionSheet();
}

function showOpenSheet() {
  state.actionSheet = { title: "Open...", actions: [["Import Fake VM", "importFakeVM()"]] };
  renderActionSheet();
}

function showDriveSheet() {
  state.actionSheet = { title: "Drive", actions: [["Change Image...", "hideSheet()"], ["Eject", "hideSheet()"]] };
  renderActionSheet();
}

function showAppSettings() {
  state.actionSheet = { title: "UTM Settings", actions: [["Close", "hideSheet()"]] };
  renderActionSheet();
}

function importFakeVM() {
  const id = `vm-${Date.now()}`;
  state.vms.push({
    ...structuredClone(defaults.vms[1]),
    id,
    name: "Imported VM",
    status: "Stopped"
  });
  state.selectedId = id;
  state.wizard = null;
  saveState();
  setRoute({ name: "detail", id });
}

function hideSheet() {
  state.actionSheet = null;
  renderActionSheet();
}

function renderActionSheet() {
  const sheet = $("actionSheet");
  if (!state.actionSheet) {
    sheet.className = "action-sheet";
    sheet.innerHTML = "";
    sheet.setAttribute("aria-hidden", "true");
    return;
  }
  sheet.className = "action-sheet active";
  sheet.setAttribute("aria-hidden", "false");
  sheet.innerHTML = `
    <div class="sheet-stack">
      <div class="sheet-group">
        <div class="sheet-title">${escapeHtml(state.actionSheet.title)}</div>
        ${state.actionSheet.actions.map(action => `<button class="sheet-action" onclick="${action[1]}">${escapeHtml(action[0])}</button>`).join("")}
      </div>
      <div class="sheet-group"><button class="sheet-action cancel" onclick="hideSheet()">Cancel</button></div>
    </div>
  `;
}

window.setRoute = setRoute;
window.openVM = openVM;
window.libraryTap = libraryTap;
window.runVM = runVM;
window.openWizard = openWizard;
window.cancelWizard = cancelWizard;
window.wizardContinue = wizardContinue;
window.wizardBack = wizardBack;
window.saveWizard = saveWizard;
window.chooseOS = chooseOS;
window.setWizardValue = setWizardValue;
window.setWizardSilent = setWizardSilent;
window.stepWizard = stepWizard;
window.chooseMachine = chooseMachine;
window.toggleWindows10 = toggleWindows10;
window.fakePickFile = fakePickFile;
window.openSettings = openSettings;
window.openSettingsPane = openSettingsPane;
window.setDraft = setDraft;
window.setNestedDraft = setNestedDraft;
window.setDraftOS = setDraftOS;
window.setDriveName = setDriveName;
window.setForceMulticore = setForceMulticore;
window.addDrive = addDrive;
window.addDevice = addDevice;
window.saveSettings = saveSettings;
window.cancelSettings = cancelSettings;
window.stopDisplay = stopDisplay;
window.pauseDisplay = pauseDisplay;
window.restartDisplay = restartDisplay;
window.toggleKeyboard = toggleKeyboard;
window.showAddDeviceSheet = showAddDeviceSheet;
window.showDonate = showDonate;
window.showEditSheet = showEditSheet;
window.showGallery = showGallery;
window.showGuide = showGuide;
window.showSupport = showSupport;
window.showOpenSheet = showOpenSheet;
window.showDriveSheet = showDriveSheet;
window.showAppSettings = showAppSettings;
window.hideSheet = hideSheet;
window.importFakeVM = importFakeVM;

render();
