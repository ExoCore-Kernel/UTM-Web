const frame = document.querySelector('iframe'), log = document.querySelector('#results');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 90000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (fn()) return; await pause(100); } throw Error(label + ' timeout');
}
const app = () => frame.contentWindow;
function pointer(name, x, y, buttons = 0) {
  const win = app(), screen = win.document.querySelector('#v86Screen'), box = screen.getBoundingClientRect();
  screen.dispatchEvent(new win.PointerEvent(name, { bubbles: true, pointerType: 'mouse', pointerId: 601, clientX: box.left + x, clientY: box.top + y, buttons }));
}
document.querySelector('#boot').onclick = async () => {
  try {
    await until(() => app().importFileToStore, 'App load');
    const bytes = await (await fetch('manual/kolibrios.img')).blob();
    const win = app();
    const ref = await win.importFileToStore(new win.File([bytes], 'kolibrios.img'), 'floppy');
    await app().importConfig({ files: [{ text: async () => JSON.stringify({ vm: { name: 'KolibriOS pointer verification', architecture: 'x86', machine: 'i440fx', memory: 128, cpu: 1, vgaMemory: 8, network: 'none', bootType: 'floppy', displayMode: 'graphical', saveOnStop: false, fileRefs: { floppy: ref } } }) }] });
    app().runVM(app().vmById().id);
    await until(() => app().__utmWebRuntime?.guestHeight >= 480, 'Kolibri graphics mode');
    log.textContent = 'Kolibri graphical mode: ' + app().__utmWebRuntime.screenSize;
  } catch(error) { log.textContent = 'FAIL ' + error.stack; }
};
for (const [id, sign] of [['right', 1], ['left', -1]]) document.querySelector('#' + id).onclick = async () => {
  pointer('pointermove', 200, 200);
  for(let i=1; i<=20; i++) { pointer('pointermove', 200 + sign * i * 5, 200); await pause(20); }
  log.textContent += '\nMoved ' + id;
};
document.querySelector('#click').onclick = async () => { pointer('pointerdown', 200, 200, 1); await pause(60); pointer('pointerup', 200, 200); log.textContent += '\nClicked'; };
document.querySelector('#stress').onclick = async () => {
  const win = app(), start = await win.emulator.get_instruction_counter();
  for (let i=0;i<120;i++) {
    pointer('pointermove', 200, 200);
    for (let j=0;j<40;j++) pointer('pointermove', 200 + Math.sin((i*40+j)/30)*100, 200 + Math.cos((i*40+j)/30)*60);
    if (i%10===0) { pointer('pointerdown',200,200,1); win.dispatchEvent(new win.PointerEvent('pointerup',{pointerType:'mouse',pointerId:601,buttons:0})); }
    await pause(16);
  }
  const end = await win.emulator.get_instruction_counter();
  log.textContent += '\nPointer stress: ' + (end - start) + ' guest instructions; ' + win.__utmWebRuntime.status;
};
document.querySelector('#close').onclick = async () => { await app().stopDisplay(true); log.textContent += '\nClosed'; };
