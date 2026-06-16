# QEMU-WASM Runtime Drop-In

UTM-Web can run the hosted Alpine demo immediately. To boot custom Linux configs locally, place a QEMU-WASM build here.

Expected files:

```text
vendor/qemu-wasm/qemu-system-x86_64.js
vendor/qemu-wasm/qemu-system-x86_64.wasm
vendor/qemu-wasm/qemu-system-x86_64.worker.js
vendor/qemu-wasm/load.js
vendor/qemu-wasm/qemu-system-x86_64.data
```

This layout follows the Emscripten output described by:

- https://github.com/ktock/qemu-wasm-sample
- https://github.com/ktock/qemu-wasm-demo

Build notes:

- Build QEMU with the qemu-wasm patch and Emscripten.
- Use `x86_64-softmmu` first; UTM-Web currently only exposes x86 Linux configs.
- Serve the app over HTTPS or localhost.
- The included `coi-serviceworker.js` supplies COOP/COEP headers needed by SharedArrayBuffer-based pthread builds on hosts such as GitHub Pages.

Custom disk/kernel files selected in the UI are kept in browser memory for the current page session. Export the `.utmweb.json` config when you want to save the launch plan.
