# UTM-Web

An iOS-style virtual machine app that runs entirely in the browser. Hosting is plain static files, compatible with free GitHub Pages. The GitHub Pages deployment needs no application server, paid service or API key. An optional local-only Node server provides full TCP internet access.

## v64 integration

The bundled engine is [speedyHKjournalist/v64](https://github.com/speedyHKjournalist/v64), build commit `87d26deb9a77c2e98b4b684f39cc72ba9065d76a`. Its API still uses the `V86` class name. Runtime scripts, CPU worker, graphics plugins, x86/ARM WebAssembly cores, portable fallbacks and firmware live in `vendor/v64/`. Nothing is loaded from an external demo at runtime. `vendor/v64/manifest.json` records provenance and SHA-256 checksums.

- x86 (32-bit), x86_64 (64-bit), ARM64 and ARM32 guest CPUs.
- 1–8 cooperative guest cores in a dedicated CPU worker, keeping the app responsive. This integration does not enable parallel host threads.
- i440FX and Q35 PC boards, SeaBIOS, and optional x64 UEFI/OVMF.
- PC VGA with keyboard/pointer/touch input; ARM virtio-gpu or serial console.
- PC ISO, RAW disk, floppy and Linux bzImage boot. ARM uses the virt board with a matching Linux Image/zImage, optional initrd and generated device tree. ARM does not boot PC ISOs or PC firmware.
- RAW, QCOW2, VHD, VDI, VMDK and VHDX disk imports through v64's format decoders. Format variants, guest drivers and OS compatibility remain subject to v64's limits; not every existing VM image will boot.
- RAM can be configured from 16–32768 MiB (32 GiB) for x86_64 and ARM64 guests. RAM above approximately 1.5 GiB uses v64’s host-backed extended-memory path with a 64 MiB Wasm cache. The x86 limit is 2047 MiB and ARM32 remains limited to 1536 MiB; the extended-memory path requires a 64-bit guest. Available device/browser memory still limits what can actually run. Large disks are read on demand and are not constrained to the guest RAM size.

The app keeps the original grouped iOS look, with larger touch targets, dynamic viewport/safe-area support, button feedback, navigation/sheet animations, reduced-motion support, and an installable home-screen manifest.

## Saving VMs in the browser

Use **Browser Storage** in the library to see origin storage usage and available capacity. **Keep Storage on This Device** requests protection against automatic browser cleanup. The browser decides its quota; gigabytes may be available, but capacity and persistence cannot be guaranteed on every device or in private browsing.

VM settings are small metadata in localStorage. Large files use IndexedDB and the Origin Private File System (OPFS), not localStorage:

- Imported ISO/kernel/initrd/container images remain in IndexedDB after reload.
- On browsers with OPFS, imported RAW disks are copied into private browser files. v64's CPU worker writes guest disk changes directly to those files and flushes them on stop. Another tab cannot write the same disk simultaneously.
- **Save** streams a snapshot to OPFS, with an IndexedDB fallback. **Close** saves a snapshot by default before stopping; this can be disabled in VM Settings → v64. Restoring streams the saved state instead of reading the whole snapshot into one ArrayBuffer.
- Disk formats other than RAW retain guest writes in the runtime overlay. Save a snapshot or use **Files → Download Compact Disk (QCOW2)** / **Save Disk Copy in Browser** to keep those changes.
- Closing a browser tab or terminating the browser is not an awaited VM stop. Use **Close** or **Save** before leaving, particularly for non-RAW disks and RAM state. RAW disk writes have periodic flushes, but an abrupt shutdown can lose pending writes.
- Replacing a saved snapshot removes its old unreferenced file. Deleting a VM removes its unshared attached files.

The old app's default-VM reset and architecture-downgrade bugs are fixed. Existing media references and VM settings are retained. Old v86 snapshots are preserved for download but are not automatically restored with the incompatible v64 runtime; remove them in v64 settings to start a fresh session.

## Compact disks and touch display

New blank disks use sparse **QCOW2** storage. A 20 GiB disk initially stores **256 KiB** of metadata; the guest still sees the full 20 GiB. Reading absent blocks returns zeros automatically, without expanding the disk into a 20 GiB browser file. This is dynamic allocation, not a ZIP archive. QCOW2 guest writes remain in the runtime overlay until saved in a snapshot: keep **Save When Stopping** enabled and use Save/Close before leaving the page. RAW OPFS disks retain their existing direct writeback behavior.

On a stopped VM without a resume snapshot, **Compact Disk Image (QCOW2)** scans an attached RAW image in bounded chunks, stores its nonzero clusters and replaces the attachment only after the new image and VM metadata are saved. The original remains usable if conversion/storage fails, and a compact download is offered. The old image is removed only if no VM still references it. A resume snapshot is never silently discarded or detached to compact a disk; run that VM and use Files to export its current disk instead.

**Files → Download Compact Disk (QCOW2)** includes current guest writes. **Download Expanded Disk (RAW)** expands it back into a conventional full-capacity image. **Save Disk Copy in Browser** streams a compact copy into OPFS when available. Zero-filled clusters are omitted; nonzero data is preserved exactly. Deleting files inside a guest does not necessarily zero their old blocks, so reclaiming that space may require the guest's free-space-zeroing tool before compaction. Expanded RAW downloads need storage for the full virtual capacity. Browsers without a streaming Save File picker must hold downloads in memory.

The VM display keeps the grouped iOS style. Boot configuration and diagnostic logs start hidden; enable **Debug** in the VM or **Debug Mode** in its details/settings to inspect them. Graphical mode has no serial overlay by default. Drag the lower-right display handle with a mouse or finger to resize while keeping the screen's proportions, or pinch with two fingers. Two fingers also move the window, including in fullscreen. **Fit** restores the largest display that fits the available screen and resets its position. Resizing, the keyboard and fullscreen preserve the running display element. VGA text-mode installers are fitted using their actual font/canvas pixel dimensions, and a guest resolution/font change automatically refits the whole screen so the bottom rows remain visible.

For relative mice such as KolibriOS PS/2 input, slide one finger to move the cursor, tap to click, and double-tap then drag to hold the mouse button. Guests with absolute pointing devices use direct touch. Two-finger gestures resize/move the viewport without clicking or dragging inside the guest. **Keyboard** focuses native device keyboard input without displaying a custom keyboard panel. Native text, Backspace, Return and composition are forwarded to the guest. Guest text assumes a US keyboard layout. Serial mode keeps its own text input. **Fullscreen** hides the app toolbar/debug overlays and shows the selected GUI or serial output, with small exit/keyboard/Fit controls. Entering fullscreen fills the available viewport as much as the guest aspect ratio permits; pinch and the corner handle still resize it, and two fingers pan it. It uses browser fullscreen where supported and a viewport-filling fallback on iOS/embedded views.

## Downloads and full-storage recovery

**Files** in the VM toolbar downloads a machine snapshot, the current disk as compact QCOW2 or expanded RAW (including guest writes), or the launch configuration. The same snapshot download is offered if saving runs out of browser storage; the VM stays open. Media that cannot fit can be attached for the current tab without persistent import.

Where the browser supports a Save File picker, snapshots/disks stream directly to a device file without staging in browser storage. Other browsers use a Blob download, which needs enough device memory for the output. Downloading does not make the browser quota larger.

Snapshots require the same runtime, hardware and original media. An OPFS writeback snapshot also references the same browser disk identity/generation; it is a resume file for that disk, not a portable bundle. For a backup you can use in another browser, download the current QCOW2 disk and launch config, reattach boot media and cold-boot the disk. Config exports do not embed OS media. Clearing website data removes local VMs, so retain downloaded disk backups.

## Boot a VM

1. Tap **+**, select the architecture, then choose matching boot media.
2. For ARM, select Linux kernel boot and use `console=ttyAMA0` for serial output. A kernel for QEMU's virt board with the required virtio/GIC drivers is needed. ARM graphical output needs the guest's virtio-gpu driver.
3. Select RAM, cores and (on PC) board/firmware. An x64 UEFI image needs x64 UEFI firmware; legacy images normally use SeaBIOS.
4. Import a disk or create an optional blank disk, save the VM and tap Play.
5. Use **Save** or **Close** to keep your session. Use **Files** for downloads.

No guest OS image is distributed with the app. The built-in runtime verification uses original, tiny machine-code probes, not an operating system. There is no host USB passthrough or native virtualization. Networking modes are described below.

## Internet and LAN access

Local networking uses a raw Ethernet WebSocket connected to QEMU's user network stack. The old WISP client was TCP-only and dropped UDP; local Auto/local modes now use `/net/` instead. QEMU runs with `-machine none`: it provides networking only, without a guest CPU, operating system or VM disk. **Each visiting PC or phone runs its VM CPU, RAM and storage in its own browser.**

Install Node 22+ and QEMU with the `user` networking backend. QEMU is already present on the development Mac. Other macOS installs can use `brew install qemu`; Linux packages commonly call it `qemu-system-x86`.

For this computer:

```sh
node scripts/serve-local.mjs
```

For other PCs and phones on the same LAN:

```sh
node scripts/serve-local.mjs --lan
```

Open one of the printed LAN URLs on the other device and select VM Settings → **Network → auto** or **local**. The serving computer supplies static files and NAT; guest execution stays on the visiting device. The LAN option binds all host IPv4 interfaces and accepts the server's own IP/hostname origins. A firewall may need to allow the chosen HTTP port. Use `UTM_PORT=4175` before the command if the default 4173 is occupied, and `UTM_QEMU=/path/to/qemu-system-x86_64` to choose an executable.

Networking modes:

- **auto**: local Ethernet NAT when the same-origin gateway is detected; otherwise limited browser HTTP.
- **local**: require the local Ethernet gateway.
- **browser**: v64's fetch adapter. CORS applies, and this does not provide arbitrary guest TLS/HTTPS or UDP.
- **none**: no network card.

The guest needs a virtio-net driver and DHCP. The default NAT network assigns addresses starting at `10.0.2.15`, router `10.0.2.2` and DNS `10.0.2.3`. TCP, native guest HTTPS, UDP, DNS and DHCP are supported. TLS is end-to-end; normal certificate validation uses the guest's CA certificates and clock. LAN destinations are reachable through the gateway host's routes. IPv6 is enabled alongside IPv4, with external reachability dependent on the host.

This is NAT networking, not literal access to every Wi-Fi protocol: no radio/monitor mode, arbitrary raw-IP protocols, transparent LAN bridging or guaranteed multicast discovery. External ICMP depends on host support; the NAT router itself responds to ping. Incoming connections are blocked by default, like normal NAT. Optional loopback TCP/UDP port forwarding is available, for one active VM at a time:

```sh
UTM_HOSTFWD='tcp:127.0.0.1:2222-:22;udp:127.0.0.1:5353-:5353' node scripts/serve-local.mjs
```

Plain HTTP LAN addresses run the VM, CPU worker and IndexedDB storage. OPFS, service workers, offline installation and some clipboard APIs require a trusted HTTPS origin; their existing browser fallbacks apply on HTTP LAN origins. Files and snapshots remain separate for each browser/device and origin. No media, RAM or VM disk is uploaded to the local server.

The local server and QEMU gateway are excluded from the GitHub Pages artifact. Pages stays static with the limited browser HTTP mode. See [QEMU networking](https://www.qemu.org/docs/master/system/devices/net.html) for NAT limitations.

Snapshots saved without a NIC must be removed before adding one. Auto's browser/local transports use the same virtio network card, but network connections and DHCP leases may need renewing after switching networks.

## Run and test

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open [the local app](http://127.0.0.1:4173/). HTTPS or localhost is required for browser storage/service workers. The scoped service worker supplies cross-origin isolation headers on GitHub Pages and caches visited app/runtime assets for offline reopening. It never deletes VM stores or another project's caches.

```sh
node --check app.js
node --check runtime-config.js
node --check browser-storage.js
node --check disk-images.mjs
node --test tests/runtime.test.cjs tests/network.test.mjs tests/ethernet.test.mjs tests/disk-images.test.mjs tests/controls.test.cjs
node scripts/prepare-pages.cjs
```

Open [runtime verification](http://127.0.0.1:4173/tests/browser.html) and tap **Run verification**. It executes x86 protected-mode, x64 long-mode, ARM64 EL1 and ARM32 SVC probes through the actual app and CPU worker; checks serial input, display retention, streamed snapshots, disk persistence across cold boots, QCOW2 export, quota failure/download recovery, temporary media, metadata migration, touch keyboard routing, resizing/fullscreen retention, sparse disk compaction/expansion and 20 GiB virtual capacity. It creates verification VMs in that browser's local library.

Optional real Linux checks:

```sh
bash scripts/fetch-linux-tests.sh
```

Then open [Linux boot tests](http://127.0.0.1:4173/tests/linux.html). These use official Alpine 3.24 x64/ARM64 kernels and initramfs to reach a shell on two cores. The downloads are ignored by Git and excluded from deployment. Test probes are original code in `tests/fixtures/`; `nasm` rebuilds the PC probes from the included assembly.

## Install UTM on iPhone or iPad

Tap **Install to Home Screen** in the library using Safari. It explicitly downloads **UTM.mobileconfig** without navigating to the XML, which adds a removable, full-screen Web Clip named **UTM**, with the original `assets/Assets.xcassets/AppIcon.appiconset/Icon.png` embedded in the profile. Allow the download, then open **Settings → Profile Downloaded → Install**. This is a home-screen app for the published site; it does not transfer local browser VMs or install a native emulator. The profile contains only that Web Clip.

The included profile opens `https://exocore-kernel.github.io/UTM-Web/`. The static Pages build regenerates it for `GITHUB_REPOSITORY`; set `UTM_APP_URL=https://your-domain.example/app/` when building for a custom domain. Run `node scripts/prepare-home-screen.cjs` to regenerate the checked-in download. The profile stays entirely static; a phone user finishes installation in Settings. The scoped service worker adds Apple’s profile MIME type and attachment headers to the Pages response, including cached downloads; the local server supplies the same headers. Safari's Share → Add to Home Screen is also available, using the same icon and UTM name. See [Apple's profile installation instructions](https://support.apple.com/en-us/102400).

## GitHub Pages

The Pages workflow runs the Node checks, prepares `dist/`, then uploads only static app/runtime files and the small runtime verification fixtures. Rust compilation and npm dependencies are unnecessary for deployment. In GitHub repository Settings → Pages, select **GitHub Actions**.

This folder was provided without `.git`. To publish while preserving your existing GitHub history, run:

```sh
bash scripts/push-to-github.sh
```

It verifies the app, clones `https://github.com/exocore-kernel/UTM-Web.git` into a fresh temporary directory, copies only project files, commits and pushes using your existing Git credentials. It never force-pushes. Pass a different repository URL as its first argument if needed. The script is provided for you to run; it has not been executed automatically.

## Licenses

UTM assets/UI references retain the repository's [Apache-2.0 license](LICENSE). v64 uses [BSD-2-Clause](vendor/v64/LICENSE). Included SoftFloat and Zstandard notices are in `vendor/v64/SOFTFLOAT-LICENSE` and `vendor/v64/ZSTD-LICENSE`. Firmware licenses/source details are in `vendor/v64/bios/` and the upstream v64 BIOS build scripts. The previous unused v86 vendor directory is retained for provenance; the app and Pages artifact use v64.

## Pointer verification

`node --test tests/controls.test.cjs` checks scaled/bounded PS/2 packets, pacing, mouse release outside the window, capture loss, blur, touch taps/drags, pinch/pan and absolute input. The normal browser suite also checks native input focus and two-finger resize/pan in fullscreen.

For optional KolibriOS testing, put an official floppy image at `tests/manual/kolibrios.img`, serve the app and open `tests/kolibri.html`. The test image used was 0.7.7.0-9254-g62b2b72c, SHA-256 `9e749e88eefa13f09dcce95553ce77495d182399ee4113559444b5e76a127f1a`, from [KolibriOS downloads](https://kolibrios.org/en/download). OS images remain excluded from Git and Pages.

## Large RAM and Debian booting

x86_64 and ARM64 settings allow **32768 MiB (32 GiB)**, using the runtime’s extended-memory implementation above approximately 1.5 GiB. The guest total remains the selected number; extra memory is placed above physical 4 GiB with a bounded 64 MiB cache in WebAssembly memory. Unused host pages may remain virtual, but this does not create additional physical RAM: a device/browser can reject a large allocation or run out of memory under a real workload. The high-memory path requires a 64-bit guest. x86 is limited to 2047 MiB; ARM32 stays at 1536 MiB to leave room for its display/device memory. Switching to a 32-bit architecture clamps the draft RAM to its supported maximum. Resume snapshots still require matching hardware settings.

For an **amd64 Debian ISO**, create a fresh **x86_64** VM; try **UEFI** and **2048–4096 MiB** as a starting configuration. A Syslinux `execute(): Fail to malloc a buffer to exec .linux` error occurs in the BIOS bootloader before Linux starts. Raising the RAM ceiling does not by itself prove that this error is fixed; the exact ISO and a successful boot are needed to verify it.

The optional real-engine check boots original bare-metal programs on both bundled 64-bit cores and verifies reads/writes at the final address of extended RAM (most guest memory stays untouched):

```sh
node --expose-gc tests/memory-smoke.mjs 2048 32768
```

The x64 probe can be rebuilt with `nasm -f bin tests/fixtures/memory64.asm -o tests/fixtures/memory64.bin`; ARM64 probe instructions are generated in the smoke script. This checks addressability and backing memory, rather than testing a desktop using every byte of 32 GiB.
