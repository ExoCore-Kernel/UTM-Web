// Optional real-engine check. Keeps most guest pages untouched; not a RAM stress
// test. Example: node --expose-gc tests/memory-smoke.mjs 2048 32768
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setImmediate as yieldCPU } from 'node:timers/promises';
import '../runtime-config.js';
import { V86 } from '../vendor/v64/build/libv86.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const MiB = 1024 ** 2, key = 0x123456789abcdef0n;
const probe = fs.readFileSync(new URL('fixtures/memory64.bin', import.meta.url));
function armProbe(top) {
  const words = [];
  const immediate = (reg, value) => {
    value = BigInt(value);
    for (let i = 0; i < 4; i++) words.push(((i ? 0xf2800000 : 0xd2800000) | i << 21 | Number(value >> BigInt(i * 16) & 65535n) << 5 | reg) >>> 0);
  };
  immediate(0, top - 8); immediate(1, key);
  words.push(0xf9000001, 0xf9400002); // str x1,[x0]; ldr x2,[x0]
  immediate(3, 0x40001000);
  words.push(0xf9000062, 0x14000000); // str x2,[x3]; b .
  const bytes = Buffer.alloc(words.length * 4); words.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
async function check(memory, architecture) {
  const arm = architecture === 'arm64';
  const vm = UTMRuntime.normalize({ architecture, memory, cpu: 1, vgaMemory: 8, network: 'none', bootType: arm ? 'kernel' : 'floppy', displayMode: 'serial' });
  const options = UTMRuntime.options(vm, {}, p => path.join(root, p));
  const extended = options.extended_memory_size;
  assert.ok(extended, 'Select more than 1537 MiB to exercise extended RAM');
  const top = 2 ** 32 + extended, page = top - 2 * MiB;
  options.cpu_worker = false; options.autostart = false;
  options.graphics_adapter = 'none'; delete options.graphics_adapter_path; delete options.vram_size;
  delete options.bios; delete options.vga_bios; delete options.firmware;
  if (arm) options.kernel = { buffer: armProbe(top) };
  else options.multiboot = { buffer: probe.buffer.slice(probe.byteOffset, probe.byteOffset + probe.byteLength) };
  let emulator = new V86(options);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Runtime load timed out')), 30000);
      emulator.add_listener('emulator-loaded', () => { clearTimeout(timeout); resolve(); });
      emulator.add_listener('emulator-error', error => { clearTimeout(timeout); reject(error); });
    });
    const cpu = emulator.v86.cpu;
    const data = new Uint8Array(8); new DataView(data.buffer).setBigUint64(0, BigInt(page), true);
    if (!arm) cpu.mem8.set(data, 0x300020);
    const deadline = Date.now() + 20000;
    const result = () => new DataView(cpu.mem8.buffer, cpu.mem8.byteOffset).getUint32(arm ? 0x1000 : 0x300000, true);
    while (!result() && Date.now() < deadline) { cpu.run_cores(); await yieldCPU(); }
    assert.equal(result(), arm ? Number(key & 0xffffffffn) : 0xc064c064, 'Long-mode guest must write and read the last qword of extended RAM');
    const actual = cpu.read_blob_physical(top - 8, 8);
    assert.equal(new DataView(actual.buffer, actual.byteOffset, 8).getBigUint64(0, true), key);
    assert.equal(cpu.extended_pages * 4096 + cpu.memory_size[0], memory * MiB);
    console.log(`PASS ${architecture} ${memory} MiB: guest accessed final RAM qword at physical 0x${(top - 8).toString(16)}; host read-back agrees.`);
  } finally { await emulator.destroy(); emulator = null; }
}
for (const memory of (process.argv.slice(2).length ? process.argv.slice(2) : ['2048']).map(Number)) { for (const arch of ['x86_64', 'arm64']) { await check(memory, arch); globalThis.gc?.(); } }
