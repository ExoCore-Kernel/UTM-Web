const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../vm-controls.js');
const { displayPixels, layout, pointerInput } = UTMControls;
class Target {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, data = {}) {
    const event = { type: name, target: this, pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 100, clientY: 100, cancelable: true, preventDefault() {}, stopPropagation() {}, ...data };
    for (const fn of this.listeners.get(name) || []) fn(event);
  }
  contains(target) { return target === this || target?.parent === this; }
  closest() { return null; }
  setPointerCapture() {}
}
function fixture(absolute = false) {
  const win = new Target(), doc = new Target(), surface = new Target(), screen = new Target(), canvas = new Target();
  doc.defaultView = win; surface.ownerDocument = doc; screen.parent = surface; canvas.parent = screen;
  screen.querySelector = () => canvas;
  screen.getBoundingClientRect = canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  const sent = [], transforms = [], timers = new Map();
  let time = 0, id = 0, running = true, view = { zoom: 1, x: 0, y: 0 };
  const controller = pointerInput(surface, screen, {
    active: () => running, absolute: () => absolute,
    send: (name, data) => sent.push([name, data]), size: () => ({ width: 1280, height: 960 }),
    view: () => view, bounds: () => ({ left: 0, top: 0, width: 400, height: 300 }),
    transform: value => { view = value; transforms.push(value); }, now: () => time,
    later: (fn, ms) => { timers.set(++id, { fn, at: time + ms }); return id; }, cancel: id => timers.delete(id)
  });
  const event = (name, data) => surface.emit(name, { target: canvas, ...data });
  const touch = (name, pointerId, x, y) => event(name, { pointerType: 'touch', pointerId, clientX: x, clientY: y });
  const lift = (pointerId, x, y, name = 'pointerup') => win.emit(name, { target: canvas, pointerType: 'touch', pointerId, clientX: x, clientY: y });
  return { controller, sent, transforms, surface, screen, canvas, win, doc, timers, event, touch, lift, tick(ms) { time += ms; for (const [key, timer] of [...timers]) if (timer.at <= time) { timers.delete(key); timer.fn(); } }, pause() { running = false; } };
}
test('viewport zoom preserves aspect ratio, allows fullscreen panning and clamps to reachable bounds', () => {
  const original = layout(390, 800, 4 / 3);
  const zoomed = layout(390, 800, 4 / 3, 3, 100, 100);
  assert.equal(original.width, 390);
  assert.equal(zoomed.width, 1170);
  assert.equal(zoomed.width / zoomed.height, 4 / 3);
  assert.equal(zoomed.x, 100);
  const edge = layout(390, 800, 4 / 3, 3, 100000, -100000);
  assert.equal(edge.x, (edge.width - 390) / 2);
  assert.equal(edge.y, -(edge.height - 800) / 2);
  assert.equal(layout(390, 800, 4 / 3, 99).zoom, 8);
});
test('desktop mouse releases outside the screen, on lost capture and window blur', () => {
  const f = fixture();
  for (const reason of ['outside', 'lostpointercapture', 'blur']) {
    f.event('pointerdown', { buttons: 1 });
    if (reason === 'outside') f.win.emit('pointerup', { target: new Target() });
    else if (reason === 'blur') f.win.emit('blur');
    else f.surface.emit(reason);
    assert.deepEqual(f.sent.at(-1), ['mouse-click', [false, false, false]]);
  }
  f.controller.destroy();
  assert.equal([...f.win.listeners.values()].reduce((n, value) => n + value.size, 0), 0);
});
test('relative movement is scaled, paced and split into valid signed PS/2 byte packets', () => {
  const f = fixture();
  f.event('pointermove', { clientX: 0, clientY: 0 });
  for (let x = 1; x <= 400; x++) f.event('pointermove', { clientX: x, clientY: x / 2 });
  assert.equal(f.sent.length, 0, 'browser moves are coalesced');
  f.controller.flush();
  assert.ok(f.sent.length <= 4, 'bounded work per tick');
  for (let i = 0; i < 10 && f.timers.size; i++) f.controller.flush();
  const packets = f.sent.filter(([name]) => name === 'mouse-delta').map(([, value]) => value);
  assert.ok(packets.every(([x, y]) => Math.abs(x) <= 127 && Math.abs(y) <= 127));
  assert.ok(Math.abs(packets.reduce((sum, value) => sum + value[0], 0) - 1280) <= 1);
  assert.ok(Math.abs(packets.reduce((sum, value) => sum + value[1], 0) + 640) <= 1);
  f.controller.destroy();
});
test('two fingers pan and pinch without sending guest clicks or resuming a one-finger drag', () => {
  const f = fixture();
  f.touch('pointerdown', 1, 100, 100); f.touch('pointerdown', 2, 200, 100);
  f.touch('pointermove', 1, 110, 120); f.touch('pointermove', 2, 210, 120);
  assert.equal(f.transforms.at(-1).x, 10); assert.equal(f.transforms.at(-1).y, 20);
  f.touch('pointermove', 2, 310, 120);
  assert.equal(f.transforms.at(-1).zoom, 2);
  f.lift(2, 310, 120);
  f.touch('pointermove', 1, 190, 180); f.lift(1, 190, 180);
  assert.deepEqual(f.sent, [], 'a viewport gesture never becomes guest input');
  f.controller.destroy();
});
test('a relative touchpad moves without holding, taps to click and double-tap drags release reliably', () => {
  const f = fixture();
  f.touch('pointerdown', 1, 100, 100); f.touch('pointermove', 1, 120, 100); f.lift(1, 120, 100);
  assert.ok(f.sent.some(([name]) => name === 'mouse-delta'));
  assert.ok(!f.sent.some(([name]) => name === 'mouse-click'));
  f.sent.length = 0;
  f.touch('pointerdown', 1, 100, 100); f.lift(1, 100, 100); f.tick(50);
  assert.deepEqual(f.sent, [['mouse-click', [true, false, false]], ['mouse-click', [false, false, false]]]);
  f.tick(100); f.sent.length = 0;
  f.touch('pointerdown', 1, 100, 100); f.touch('pointermove', 1, 130, 100);
  assert.deepEqual(f.sent[0], ['mouse-click', [true, false, false]]);
  f.lift(1, 130, 100, 'pointercancel');
  assert.deepEqual(f.sent.at(-1), ['mouse-click', [false, false, false]]);
  f.controller.destroy();
});
test('absolute touch uses the display bounds and does not also inject relative packets', () => {
  const f = fixture(true);
  f.touch('pointerdown', 1, 123, 87); f.lift(1, 123, 87); f.tick(50);
  assert.deepEqual(f.sent[0], ['mouse-absolute', [123, 87, 400, 300]]);
  assert.ok(!f.sent.some(([name]) => name === 'mouse-delta'));
  assert.deepEqual(f.sent.at(-1), ['mouse-click', [false, false, false]]);
  f.controller.destroy();
});


test('VGA text size is fitted as pixels rather than character columns and rows', () => {
  assert.deepEqual(displayPixels([80, 25, 0], { width: 720, height: 400 }), { width: 720, height: 400 });
  assert.deepEqual(displayPixels([80, 25, 0]), { width: 720, height: 400 });
  assert.deepEqual(displayPixels([80, 25, 0], { width: 640, height: 350 }), { width: 640, height: 350 });
  assert.deepEqual(displayPixels([1024, 768, 32]), { width: 1024, height: 768 });
  const pixels = displayPixels([80, 25, 0], { width: 720, height: 400 });
  const fitted = layout(1512, 982, pixels.width / pixels.height);
  assert.ok(fitted.width <= 1512 && fitted.height <= 982);
  assert.equal(fitted.width / fitted.height, 1.8);
});
