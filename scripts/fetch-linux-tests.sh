#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Optional, official Alpine Linux netboot materials, kept out of Git and Pages.
for guest_arch in x86_64 aarch64; do
  mkdir -p "tests/manual/$guest_arch"
  for boot_file in vmlinuz-virt initramfs-virt; do
    curl --fail --location --retry 2 "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/$guest_arch/netboot/$boot_file" --output "tests/manual/$guest_arch/$boot_file"
  done
done
echo 'Open http://127.0.0.1:4173/tests/linux.html while the static preview server is running.'
