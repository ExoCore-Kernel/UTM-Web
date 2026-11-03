// Produce a plain static artifact. No server, build service or credentials required.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'app.js', 'runtime-config.js', 'browser-storage.js', 'disk-images.mjs', 'styles.css', 'coi-serviceworker.js', 'manifest.webmanifest', '.nojekyll', 'LICENSE', 'README.md']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const folder of ['assets', 'vendor/v64']) fs.cpSync(path.join(root, folder), path.join(output, folder), { recursive: true });
fs.mkdirSync(path.join(output, 'tests/fixtures'), { recursive: true });
for (const file of ['browser.html', 'browser.mjs']) fs.copyFileSync(path.join(root, 'tests', file), path.join(output, 'tests', file));
for (const file of ['x86.img', 'x86_64.img', 'arm64.bin', 'arm32.bin', 'disk.img']) fs.copyFileSync(path.join(root, 'tests/fixtures', file), path.join(output, 'tests/fixtures', file));
function check(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) check(target);
    else if (fs.statSync(target).size >= 100 * 1024 * 1024) throw new Error(`File exceeds GitHub's normal repository size limit: ${target}`);
  }
}
check(output);
console.log('Static GitHub Pages artifact ready in dist/.');
