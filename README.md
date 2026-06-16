# UTM-Web

UTM-Web is an early browser UI port of the UTM virtual machine app. Right now it is a frontend-only prototype: no VM runtime, no backend, and no real disk, network, display, or JIT execution yet.

The goal is to evolve this into a JIT-enabled UTM port for web browsers. This first version focuses on matching the iOS and iPadOS UTM experience closely enough that the real runtime work can be wired in later.

## Current Scope

- Touch-first iPhone-style UTM library UI
- iPadOS-style split view for wider screens
- Fake VM creation through UTM-like setup wizard pages
- Editable fake VM settings using grouped iOS form/list styling
- Static VM display surface with floating toolbar
- UTM source assets copied locally where available
- SF Symbol-inspired fallback icons for controls that are `systemImage` values in UTM's SwiftUI source

## Not Implemented Yet

- QEMU runtime
- JIT execution
- VM storage
- SPICE display streaming
- USB, audio, networking, or clipboard integration
- Real import/export of `.utm` packages

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
- `Platform/Shared/VMNavigationListView.swift`
- `Platform/Shared/VMCardView.swift`
- `Platform/Shared/VMDetailsView.swift`
- `Platform/Shared/VMWizard*.swift`
- `Platform/Shared/VMConfig*.swift`

## License

This prototype includes assets and UI references from UTM. UTM is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
