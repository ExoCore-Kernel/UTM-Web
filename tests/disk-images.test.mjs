import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBlank, compactRaw } from '../disk-images.mjs';

async function image(produce) {
  const chunks = [];
  await produce(chunk => chunks.push(chunk));
  return Buffer.concat(chunks);
}

test('a 20 GiB blank disk stores only metadata and reports its full capacity', async () => {
  const capacity = 20 * 1024 ** 3;
  const bytes = await image(write => createBlank(capacity, write));
  assert.equal(bytes.readUInt32BE(0), 0x514649fb);
  assert.equal(Number(bytes.readBigUInt64BE(24)), capacity);
  assert.equal(bytes.length, 256 * 1024);
  await assert.rejects(createBlank(513, () => {}), /capacity/);
});

test('sparse compaction retains data at the beginning, middle and partial last cluster', async () => {
  const raw = Buffer.alloc(5 * 1024 * 1024 + 512);
  raw.write('BOOT', 0);
  raw.write('MIDDLE', 2 * 1024 * 1024 + 19);
  raw.write('END', raw.length - 3);
  const bytes = await image(write => compactRaw(new Blob([raw]), write));
  assert.ok(bytes.length < raw.length / 5);
  assert.equal(Number(bytes.readBigUInt64BE(24)), raw.length);
  // Decode the uncompressed QCOW2 table independently and compare every byte.
  const cluster = 2 ** bytes.readUInt32BE(20);
  const l1 = Number(bytes.readBigUInt64BE(40));
  const mask = (1n << 63n) - 1n;
  const restored = Buffer.alloc(raw.length);
  for (let offset = 0; offset < raw.length; offset += cluster) {
    const index = offset / cluster;
    const l2 = Number(bytes.readBigUInt64BE(l1 + Math.floor(index / (cluster / 8)) * 8) & mask);
    if (!l2) continue;
    const data = Number(bytes.readBigUInt64BE(l2 + index % (cluster / 8) * 8) & mask);
    if (data) bytes.copy(restored, offset, data, data + Math.min(cluster, raw.length - offset));
  }
  assert.deepEqual(restored, raw);
});

test('QEMU validates sparse metadata and expands compacted RAW losslessly', async t => {
  try { execFileSync('qemu-img', ['--version'], { stdio: 'ignore' }); }
  catch { t.skip('qemu-img is optional; independent format/data checks still run'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'utm-sparse-'));
  try {
    const blank = path.join(directory, 'blank.qcow2');
    await fs.writeFile(blank, await image(write => createBlank(20 * 1024 ** 3, write)));
    execFileSync('qemu-img', ['check', blank]);
    const info = JSON.parse(execFileSync('qemu-img', ['info', '--output=json', blank]));
    assert.equal(info['virtual-size'], 20 * 1024 ** 3);
    const raw = Buffer.alloc(3 * 1024 * 1024 + 512);
    raw.write('GUEST-DATA', 0); raw.write('LAST-SECTOR', raw.length - 64);
    const compact = path.join(directory, 'compact.qcow2'), expanded = path.join(directory, 'expanded.img');
    await fs.writeFile(compact, await image(write => compactRaw(new Blob([raw]), write)));
    execFileSync('qemu-img', ['check', compact]);
    execFileSync('qemu-img', ['convert', '-f', 'qcow2', '-O', 'raw', compact, expanded]);
    assert.deepEqual(await fs.readFile(expanded), raw);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
