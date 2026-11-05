#!/usr/bin/env bash
# Run this yourself when ready to publish. It preserves the remote's Git history
# even when this working folder came from GitHub's Download ZIP button.
set -euo pipefail
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
repository_url="${1:-https://github.com/exocore-kernel/UTM-Web.git}"
cd "$source_dir"
node --test tests/runtime.test.cjs tests/network.test.mjs tests/ethernet.test.mjs tests/disk-images.test.mjs tests/controls.test.cjs
node scripts/prepare-pages.cjs
publish_dir="$(mktemp -d "${TMPDIR:-/tmp}/utm-web-publish.XXXXXX")"
git clone --branch main --single-branch "$repository_url" "$publish_dir"
for source_item in index.html app.js runtime-config.js browser-storage.js vm-controls.js disk-images.mjs styles.css coi-serviceworker.js manifest.webmanifest UTM.mobileconfig assets vendor/v64 tests scripts .github .gitignore .nojekyll LICENSE README.md; do
  mkdir -p "$publish_dir/$(dirname "$source_item")"
  rsync -a --exclude='manual/' --exclude='.DS_Store' "$source_dir/$source_item" "$publish_dir/$(dirname "$source_item")/"
done
git -C "$publish_dir" add -- index.html app.js runtime-config.js browser-storage.js vm-controls.js disk-images.mjs styles.css coi-serviceworker.js manifest.webmanifest UTM.mobileconfig assets vendor/v64 tests scripts .github .gitignore .nojekyll LICENSE README.md
if git -C "$publish_dir" diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi
git -C "$publish_dir" commit -m "Add v64 browser VMs, persistent storage and LAN TCP/UDP networking"
git -C "$publish_dir" push origin HEAD:main
echo "Pushed successfully from $publish_dir"
