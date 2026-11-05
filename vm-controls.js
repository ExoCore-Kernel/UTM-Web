/* Browser input and viewport gestures; independent of the emulated machine. */
(function (root) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function layout(width, height, ratio, zoom = 1, x = 0, y = 0) {
    const baseWidth = Math.min(width, height * ratio);
    zoom = clamp(zoom, Math.min(1, 160 / Math.max(1, baseWidth)), 8);
    const w = baseWidth * zoom, h = w / ratio;
    // Keep at least a useful portion visible when moving a small window. Large
    // windows pan to their edges, so their contents cannot be lost off screen.
    const limit = (size, viewport) => size > viewport ? (size - viewport) / 2 : (viewport - size) / 2;
    return { width: w, height: h, baseWidth, zoom,
      x: clamp(x, -limit(w, width), limit(w, width)), y: clamp(y, -limit(h, height), limit(h, height)) };
  }

  function pointerInput(surface, screen, options) {
    const doc = surface.ownerDocument, win = doc.defaultView;
    const cleanups = [], points = new Map();
    const now = options.now || (() => performance.now());
    const later = options.later || ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.cancel || clearTimeout;
    let destroyed = false, buttons = [false, false, false], lastMouse, touch, gesture, blockedTouch = false;
    let lastTap = null, dx = 0, dy = 0, absolute = null, wheelX = 0, wheelY = 0, timer = null, tapTimer = null;
    const active = () => !destroyed && options.active();
    const send = (name, value) => { if (!destroyed) options.send(name, value); };
    const on = (target, name, fn, extra) => {
      target.addEventListener(name, fn, extra);
      cleanups.push(() => target.removeEventListener(name, fn, extra));
    };
    const inside = event => screen.contains(event.target);
    const control = event => event.target.closest?.('button,input,textarea,select,a,.debug-panel');
    const capture = id => { try { surface.setPointerCapture(id); } catch { /* Pointer already cancelled. */ } };
    const rect = () => {
      const canvas = screen.querySelector('canvas'), box = canvas?.getBoundingClientRect();
      return box?.width && box?.height ? box : screen.getBoundingClientRect();
    };
    const discardMotion = () => { dx = dy = wheelX = wheelY = 0; absolute = null; if (timer !== null) cancel(timer); timer = null; };
    const flush = () => {
      if (timer !== null) cancel(timer);
      timer = null;
      if (!active()) { discardMotion(); return; }
      if (options.absolute()) {
        if (absolute) send('mouse-absolute', absolute);
        dx = dy = 0;
      } else {
        // PS/2 packets contain signed byte deltas. Bound each packet and pace
        // traffic instead of flooding old guests or wrapping large movements.
        for (let count = 0; count < 4 && (Math.trunc(dx) || Math.trunc(dy)); count++) {
          const x = clamp(Math.trunc(dx), -127, 127), y = clamp(Math.trunc(dy), -127, 127);
          send('mouse-delta', [x, y]); dx -= x; dy -= y;
        }
      }
      absolute = null;
      if (wheelX || wheelY) { send('mouse-wheel', [wheelY, wheelX]); wheelX = wheelY = 0; }
      if (Math.trunc(dx) || Math.trunc(dy)) timer = later(flush, 16);
    };
    const schedule = () => { if (timer === null) timer = later(flush, 16); };
    const position = event => {
      const box = rect();
      if (!box.width || !box.height) return;
      absolute = [clamp(event.clientX - box.left, 0, box.width), clamp(event.clientY - box.top, 0, box.height), box.width, box.height];
      schedule();
    };
    const movement = (x, y) => {
      const box = rect(), size = options.size();
      if (!box.width || !box.height) return;
      dx = clamp(dx + x * size.width / box.width, -size.width * 2, size.width * 2);
      dy = clamp(dy - y * size.height / box.height, -size.height * 2, size.height * 2);
      schedule();
    };
    const release = () => {
      if (tapTimer !== null) cancel(tapTimer);
      tapTimer = null;
      // Release even when the pointer left the display or the VM stopped.
      if (buttons.some(Boolean)) send('mouse-click', [false, false, false]);
      buttons = [false, false, false];
    };
    const click = value => {
      if (!active()) return;
      flush(); buttons = value; send('mouse-click', value.slice());
    };
    const tap = () => {
      release(); click([true, false, false]);
      // Give polling guests a frame to observe a touch click before release.
      tapTimer = later(() => { tapTimer = null; release(); }, 50);
    };
    const pair = () => [...points.values()].slice(0, 2);
    const centroid = values => ({ x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2,
      distance: Math.max(1, Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)) });
    const startGesture = () => {
      release(); discardMotion(); touch = null; lastTap = null; blockedTouch = true;
      const center = centroid(pair());
      gesture = { ...center, view: options.view(), bounds: options.bounds() };
    };
    const moveGesture = () => {
      const center = centroid(pair()), scale = center.distance / gesture.distance;
      const anchorX = gesture.x - (gesture.bounds.left + gesture.bounds.width / 2);
      const anchorY = gesture.y - (gesture.bounds.top + gesture.bounds.height / 2);
      options.transform({ zoom: gesture.view.zoom * scale,
        x: center.x - gesture.x + gesture.view.x * scale + anchorX * (1 - scale),
        y: center.y - gesture.y + gesture.view.y * scale + anchorY * (1 - scale) });
    };
    on(surface, 'pointerdown', event => {
      if (control(event) || !active()) return;
      if (event.pointerType === 'touch') {
        event.preventDefault(); capture(event.pointerId);
        points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (points.size >= 2) { startGesture(); return; }
        if (blockedTouch || !inside(event)) return;
        release();
        options.focus?.(true);
        const doubleTap = lastTap && now() - lastTap.time < 350 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 25;
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: now(), moved: false, drag: !!doubleTap };
        if (options.absolute()) position(event);
        // Wait for motion before a direct-touch drag, allowing a second finger
        // to claim the gesture without a stray guest click.
        return;
      }
      if (!inside(event)) return;
      event.preventDefault(); options.focus?.(false); capture(event.pointerId);
      lastMouse = { x: event.clientX, y: event.clientY };
      if (options.absolute()) position(event);
      const next = [!!(event.buttons & 1), !!(event.buttons & 4), !!(event.buttons & 2)];
      click(next);
    });
    on(surface, 'pointermove', event => {
      if (event.pointerType === 'touch') {
        if (!points.has(event.pointerId)) return;
        event.preventDefault();
        points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (gesture && points.size >= 2) { moveGesture(); return; }
        if (!touch || blockedTouch || touch.id !== event.pointerId || !active()) return;
        if (Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) > 5) touch.moved = true;
        if (options.absolute()) {
          position(event);
          if (touch.moved && !buttons[0]) click([true, false, false]);
        } else {
          if (touch.drag && touch.moved && !buttons[0]) click([true, false, false]);
          movement(event.clientX - touch.x, event.clientY - touch.y);
        }
        touch.x = event.clientX; touch.y = event.clientY;
        return;
      }
      if (!active() || control(event) || (!inside(event) && !buttons.some(Boolean))) return;
      if (options.absolute()) position(event);
      else if (doc.pointerLockElement) movement(event.movementX || 0, event.movementY || 0);
      else if (lastMouse) movement(event.clientX - lastMouse.x, event.clientY - lastMouse.y);
      lastMouse = { x: event.clientX, y: event.clientY };
      // Recover a release missed during a browser/OS interruption.
      if (!event.buttons && buttons.some(Boolean)) release();
    });
    const end = event => {
      if (event.pointerType === 'touch') {
        if (!points.has(event.pointerId)) return;
        let tapped = false;
        if (touch?.id === event.pointerId && !blockedTouch && event.type === 'pointerup' && active()) {
          flush();
          if (!touch.moved && now() - touch.time < 500) {
            if (options.absolute()) { position(event); flush(); }
            tap(); tapped = true; lastTap = { x: event.clientX, y: event.clientY, time: now() };
          } else lastTap = null;
        }
        points.delete(event.pointerId); touch = null;
        if (!tapped) release();
        if (points.size < 2) gesture = null;
        if (!points.size) { blockedTouch = false; discardMotion(); }
      } else { flush(); release(); lastMouse = null; }
    };
    on(win, 'pointerup', end, true);
    on(win, 'pointercancel', end, true);
    on(surface, 'lostpointercapture', end);
    on(surface, 'pointerleave', event => { if (event.pointerType !== 'touch' && !buttons.some(Boolean)) lastMouse = null; });
    on(surface, 'wheel', event => {
      if (!inside(event) || !active()) return;
      event.preventDefault();
      if (event.ctrlKey) { options.zoomAt?.(Math.exp(-event.deltaY * .01), event.clientX, event.clientY); return; }
      wheelY -= Math.sign(event.deltaY); wheelX -= Math.sign(event.deltaX); schedule();
    }, { passive: false });
    on(surface, 'contextmenu', event => { if (inside(event)) event.preventDefault(); });
    // Suppress compatibility mouse/touch events: only Pointer Events own input.
    for (const name of ['mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) on(surface, name, event => {
      if (inside(event) || points.size) { if (event.cancelable) event.preventDefault(); event.stopPropagation(); }
    }, { passive: false });
    const reset = () => { release(); discardMotion(); points.clear(); touch = gesture = lastMouse = lastTap = null; blockedTouch = false; };
    on(win, 'blur', reset);
    on(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });
    return { reset, flush, destroy() { reset(); destroyed = true; cleanups.forEach(fn => fn()); } };
  }

  root.UTMControls = { layout, pointerInput };
})(globalThis);
