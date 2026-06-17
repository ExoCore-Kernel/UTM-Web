# UTM-Web

UTM-Web is a browser-first UTM prototype. It keeps the iOS/iPadOS-style UTM shell while only exposing VM features that can honestly run from a static web app.

Live app: https://exocore-kernel.github.io/UTM-Web/

## Current Scope

- Touch-first UTM library, detail view, setup wizard, and VM settings UI
- Local QEMU-WASM runtime from the `external/qemu-wasm-demo` Git submodule
- Packaged Alpine Linux boot target loaded from the repository, not an external demo page
- Custom ISO, kernel, initrd, raw disk, qcow2 disk, and vmdk disk import into browser IndexedDB storage
- QEMU launch arguments generated directly from VM settings
- Serial console with local PTY input/output for the bundled upstream runtime
- Graphical display mode that attaches `Module.canvas`, uses `-display sdl,gl=off`, and forwards mouse/touch pointer input for canvas-enabled QEMU-WASM builds
- Disk save-back from `/utm/disk.img` into the stored browser blob with the display `SAVE` button
- Export/import of `.utmweb.json` launch configs

## Runtime

The QEMU-WASM runtime is vendored as a submodule:

```sh
git submodule update --init --recursive --depth 1
```

The app currently targets the x86_64 build from:

- https://github.com/ktock/qemu-wasm-demo
- https://github.com/ktock/qemu-wasm-sample

GitHub Pages deploys with recursive submodules, and the `Update QEMU-WASM` workflow refreshes the submodule pointer weekly or on manual dispatch.

The included x86_64 demo build is serial-first. UTM-Web exposes a graphical display mode and canvas input path, but graphical guests need a QEMU-WASM build compiled with browser canvas/SDL display support.

## Custom Media And Disk State

Custom VM media is stored in IndexedDB, so selected ISO and disk images remain available after reloads in the same browser profile. For ISO installs, attach a writable disk image as the VM disk. When the guest has flushed its disk writes, use `SAVE` in the VM display toolbar to copy the current `/utm/disk.img` bytes back into IndexedDB.

Disk format is inferred from the filename:

- `.qcow2` / `.qcow` -> `format=qcow2`
- `.vmdk` -> `format=vmdk`
- everything else -> `format=raw`

Browser storage quotas still apply, so large ISOs and disks may fail to import on some devices.

## Removed From The Prototype

These UTM-native features are intentionally hidden because a static browser app cannot provide them directly:

- Apple Virtualization
- SPICE display streaming
- USB passthrough
- TPM/Secure Boot
- Host audio devices
- Native host networking and port forwarding
- Sparse disk creation

## Run Locally

This is a static app. From the project directory:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

The app registers `coi-serviceworker.js` on localhost/HTTPS so the QEMU-WASM pthread build gets COOP/COEP isolation.

## Source Reference

The UI is modeled from the UTM SwiftUI source in `UTM-main`, especially:

- `Platform/iOS/VMWizardView.swift`
- `Platform/iOS/VMSettingsView.swift`
- `Platform/iOS/VMToolbarView.swift`
- `Platform/Shared/VMWizard*.swift`
- `Platform/Shared/VMConfig*.swift`

The QEMU launch-plan shape follows:

- `Configuration/QEMUArgumentBuilder.swift`
- `Configuration/UTMQemuConfiguration+Arguments.swift`
- `Configuration/UTMQemuConfigurationSystem.swift`

## License

This prototype includes assets and UI references from UTM. UTM is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
