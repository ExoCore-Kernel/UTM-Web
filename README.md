# UTM-Web

UTM-Web is a browser-first UTM prototype. It keeps the iOS/iPadOS-style UTM shell while only exposing VM features that can honestly run from a static web app.

Live app: https://exocore-kernel.github.io/UTM-Web/

## Current Scope

- Touch-first UTM library, detail view, setup wizard, and VM settings UI
- Local v86 runtime vendored in `vendor/v86`
- Real VGA display through v86's browser screen adapter
- Mouse, touch, keyboard, and serial-log input routed through v86
- Custom ISO, raw disk, floppy image, Linux bzImage, initrd, and v86 state import into browser IndexedDB storage
- VM settings mapped into actual v86 options such as memory, VGA memory, boot media, boot order, and initial state
- v86 save-state snapshots stored locally with the display `SAVE` button
- Export/import of `.utmweb.json` launch configs

## Runtime

The browser backend is v86:

- Runtime package: https://github.com/copy/v86
- Local files: `vendor/v86/build/libv86.mjs`, `vendor/v86/build/v86.wasm`, and `vendor/v86/build/v86-fallback.wasm`
- BIOS files: `vendor/v86/bios/seabios.bin` and `vendor/v86/bios/vgabios.bin`

The runtime is loaded from this repository, so GitHub Pages does not redirect to an external emulator demo.

## Custom Media And State

Custom VM media is stored in IndexedDB, so selected media remains available after reloads in the same browser profile.

Supported boot media:

- ISO: attached as v86 `cdrom`
- Raw disk/image: attached as v86 `hda`
- Floppy image: attached as v86 `fda`
- Linux bzImage/initrd: attached as v86 `bzimage` and `initrd`
- Save state: attached as v86 `initial_state`

Use `SAVE` in the VM display toolbar to store a v86 machine-state snapshot. Restoring a state requires the same VM settings and media layout that created it.

Browser storage quotas still apply, so large ISOs, disk images, and state files may fail to import or save on some devices.

## Removed From The Prototype

These UTM-native features are intentionally hidden because a static browser app cannot provide them directly:

- Apple Virtualization
- SPICE display streaming
- USB passthrough
- TPM/Secure Boot
- Host audio devices
- Native host networking and port forwarding
- Sparse disk creation
- Architectures not supported by the vendored v86 runtime

## Run Locally

This is a static app. From the project directory:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

The app registers `coi-serviceworker.js` on localhost/HTTPS so WebAssembly runtimes can use browser isolation when needed.

## Source Reference

The UI is modeled from the UTM SwiftUI source in `UTM-main`, especially:

- `Platform/iOS/VMWizardView.swift`
- `Platform/iOS/VMSettingsView.swift`
- `Platform/iOS/VMToolbarView.swift`
- `Platform/Shared/VMWizard*.swift`
- `Platform/Shared/VMConfig*.swift`

The runtime mapping references the local `v86-master` source, especially:

- `src/browser/starter.js`
- `src/browser/screen.js`
- `src/browser/mouse.js`
- `v86.d.ts`

## License

This prototype includes assets and UI references from UTM. UTM is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

The vendored v86 runtime is licensed under BSD-2-Clause. See [vendor/v86/LICENSE](vendor/v86/LICENSE).
