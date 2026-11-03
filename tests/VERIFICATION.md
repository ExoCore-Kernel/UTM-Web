# Verification — 3 November 2026

## Final checks

- 13 Node tests passed, including real QEMU DHCP traffic, gateway child-process cleanup, local-origin checks, packet transport, VM configuration/migration and pinned runtime checksums. Syntax checks and static Pages packaging passed.
- Earlier browser checks passed for x86 protected mode, x64 long mode, ARM64 EL1, ARM32 SVC, snapshots, retained display elements, RAW disk persistence across cold boots and quota/download recovery.
- The LAN-hosted browser at the serving computer's LAN address booted Linux and loaded virtio-net. Browser automation subsequently became unavailable, so the remaining live protocol tests used the same v64 engine with real Linux kernels in Node, through the actual LAN HTTP/WebSocket server and QEMU Ethernet gateway.
- Real x64 and ARM64 guests passed DHCP, public DNS resolution, UDP DNS through 10.0.2.3, public TCP DNS to 1.1.1.1, gateway ICMP ping, LAN TCP stream-integrity checks and binary UDP datagrams of 1, 37 and 4096 bytes, including fragmentation.
- The ARM64 guest additionally passed LAN HTTP, public HTTPS to example.com, and OpenSSL TLS verification with its CA store, `-verify_hostname` and `-verify_return_error`. Certificate checking was not bypassed.
- IPv6 addresses/routes were configured, but an external IPv6 ping failed. External IPv6/ICMP therefore remain host/NAT-dependent and are not claimed as universally working.
- Each VM CPU/RAM remains in the visiting browser in the app. The local gateway runs QEMU with `-machine none`, no guest CPU, no OS and no VM disks. HTTP LAN origins use IndexedDB when secure-context-only storage APIs are unavailable.

## Limits and delivery

This is Ethernet NAT supporting normal TCP/UDP applications, not every protocol a physical Wi-Fi interface can carry. Radio passthrough, arbitrary raw-IP protocols and transparent multicast/LAN bridging are not provided. Incoming services need explicit forwarding. No physical phone or second PC was controlled during verification; LAN-address serving and the client-side architecture were verified on this computer.

The Pages artifact contains static files only. No GitHub push/deployment was performed. `bash scripts/push-to-github.sh` verifies, clones the existing **main** branch and pushes `HEAD:main` without force-pushing. Native .utm import remains excluded.
