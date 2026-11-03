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
- RAM is limited to 16–1536 MiB per VM for this browser integration. Large disks are read on demand and are not constrained to the guest RAM size.

The app keeps the original grouped iOS look, with larger touch targets, dynamic viewport/safe-area support, button feedback, navigation/sheet animations, reduced-motion support, and an installable home-screen manifest.

## Saving VMs in the browser

Use **Browser Storage** in the library to see origin storage usage and available capacity. **Keep Storage on This Device** requests protection against automatic browser cleanup. The browser decides its quota; gigabytes may be available, but capacity and persistence cannot be guaranteed on every device or in private browsing.

VM settings are small metadata in localStorage. Large files use IndexedDB and the Origin Private File System (OPFS), not localStorage:

- Imported ISO/kernel/initrd/container images remain in IndexedDB after reload.
- On browsers with OPFS, imported RAW disks and newly created blank disks are copied into private browser files. v64's CPU worker writes guest disk changes directly to those files and flushes them on stop. Another tab cannot write the same disk simultaneously.
- **Save** streams a snapshot to OPFS, with an IndexedDB fallback. **Close** saves a snapshot by default before stopping; this can be disabled in VM Settings → v64. Restoring streams the saved state instead of reading the whole snapshot into one ArrayBuffer.
- Disk formats other than RAW retain guest writes in the runtime overlay. Save a snapshot or use **Files → Download Current Disk** / **Save Disk Copy in Browser** to keep those changes.
- Closing a browser tab or terminating the browser is not an awaited VM stop. Use **Close** or **Save** before leaving, particularly for non-RAW disks and RAM state. RAW disk writes have periodic flushes, but an abrupt shutdown can lose pending writes.
- Replacing a saved snapshot removes its old unreferenced file. Deleting a VM removes its unshared attached files.

The old app's default-VM reset and architecture-downgrade bugs are fixed. Existing media references and VM settings are retained. Old v86 snapshots are preserved for download but are not automatically restored with the incompatible v64 runtime; remove them in v64 settings to start a fresh session.

## Downloads and full-storage recovery

**Files** in the VM toolbar downloads a machine snapshot, the current disk as QCOW2 (including guest writes), or the launch configuration. The same snapshot download is offered if saving runs out of browser storage; the VM stays open. Media that cannot fit can be attached for the current tab without persistent import.

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
node --test tests/runtime.test.cjs tests/network.test.mjs tests/ethernet.test.mjs
node scripts/prepare-pages.cjs
```

Open [runtime verification](http://127.0.0.1:4173/tests/browser.html) and tap **Run verification**. It executes x86 protected-mode, x64 long-mode, ARM64 EL1 and ARM32 SVC probes through the actual app and CPU worker; checks serial input, display retention, streamed snapshots, disk persistence across cold boots, QCOW2 export, quota failure/download recovery, temporary media and metadata migration. It creates verification VMs in that browser's local library.

Optional real Linux checks:

```sh
bash scripts/fetch-linux-tests.sh
```

Then open [Linux boot tests](http://127.0.0.1:4173/tests/linux.html). These use official Alpine 3.24 x64/ARM64 kernels and initramfs to reach a shell on two cores. The downloads are ignored by Git and excluded from deployment. Test probes are original code in `tests/fixtures/`; `nasm` rebuilds the PC probes from the included assembly.

## GitHub Pages

The Pages workflow runs the Node checks, prepares `dist/`, then uploads only static app/runtime files and the small runtime verification fixtures. Rust compilation and npm dependencies are unnecessary for deployment. In GitHub repository Settings → Pages, select **GitHub Actions**.

This folder was provided without `.git`. To publish while preserving your existing GitHub history, run:

```sh
bash scripts/push-to-github.sh
```

It verifies the app, clones `https://github.com/exocore-kernel/UTM-Web.git` into a fresh temporary directory, copies only project files, commits and pushes using your existing Git credentials. It never force-pushes. Pass a different repository URL as its first argument if needed. The script is provided for you to run; it has not been executed automatically.

## Licenses

UTM assets/UI references retain the repository's [Apache-2.0 license](LICENSE). v64 uses [BSD-2-Clause](vendor/v64/LICENSE). Included SoftFloat and Zstandard notices are in `vendor/v64/SOFTFLOAT-LICENSE` and `vendor/v64/ZSTD-LICENSE`. Firmware licenses/source details are in `vendor/v64/bios/` and the upstream v64 BIOS build scripts. The previous unused v86 vendor directory is retained for provenance; the app and Pages artifact use v64.
