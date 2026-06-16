# UTM-Web

UTM-Web is a browser-first UTM prototype. It keeps the iOS/iPadOS-style UTM shell, but now only exposes features that can honestly work in a static browser app.

Live app: https://exocore-kernel.github.io/UTM-Web/

## Current Scope

- Touch-first UTM library, details, setup wizard, and settings UI
- Real QEMU command generation from VM settings
- Hosted QEMU-WASM Alpine Linux boot target
- Local QEMU-WASM runtime drop-in path for custom Linux configs
- Transient browser file selection for kernel/initrd/disk images
- Export/import of `.utmweb.json` launch configs
- Copyable generated QEMU arguments

## Removed From The Prototype

These UTM-native features are intentionally not shown because a static browser app cannot provide them directly:

- Apple Virtualization
- Windows and Classic Mac OS setup flows
- SPICE display streaming
- USB passthrough
- TPM/Secure Boot
- Host audio devices
- Native host networking and port forwarding
- Persistent sparse disk creation

## QEMU-WASM

The live Alpine target is based on:

- https://github.com/ktock/qemu-wasm-demo
- https://github.com/ktock/qemu-wasm-sample

For custom Linux configs, place a QEMU-WASM build in:

```text
vendor/qemu-wasm/
```

See [vendor/qemu-wasm/README.md](vendor/qemu-wasm/README.md) for the expected file layout.

## Run Locally

This is a static app. From the project directory:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

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
