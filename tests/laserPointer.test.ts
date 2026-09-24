// @vitest-environment happy-dom
//
// L3 — laser pointer overlay (toggle lives in the presentation HUD).
//
// Contracts under test:
//  - arm/disarm pointer-events, event consumption (no slide nav),
//    velocity-tapered smoothed stroke, trail decay + loop parking, HiDPI
//    buffer scaling, HUD-wake notification, full teardown.
//
// rAF and performance.now are stubbed so frames and decay are deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LaserPointerOverlay, LaserPointerOptions } from '../src/presentation/laserPointer';

// ----------------------------------------------------------- test scaffolding

interface RecordedOp {
  op: string;
  args: unknown[];
}

type Recording = {
  ops: RecordedOp[];
  lineWidths: number[];
  alphas: number[];
  count: (op: string) => number;
};

/** Replace the setup-dom canvas stub with a recording 2D context. */
function installRecordingContext(): Recording {
  const ops: RecordedOp[] = [];
  const lineWidths: number[] = [];
  const alphas: number[] = [];
  const ctx: Record<string, unknown> = {
    canvas: null,
    lineWidth: 1,
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: '',
    clearRect: (...args: unknown[]) => ops.push({ op: 'clearRect', args }),
    beginPath: () => ops.push({ op: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => ops.push({ op: 'moveTo', args }),
    lineTo: (...args: unknown[]) => ops.push({ op: 'lineTo', args }),
    quadraticCurveTo: (...args: unknown[]) => ops.push({ op: 'quadraticCurveTo', args }),
    closePath: () => ops.push({ op: 'closePath', args: [] }),
    stroke: () => {
      ops.push({ op: 'stroke', args: [] });
      lineWidths.push(ctx.lineWidth as number);
      alphas.push(ctx.globalAlpha as number);
    },
    arc: (...args: unknown[]) => ops.push({ op: 'arc', args }),
    fill: () => ops.push({ op: 'fill', args: [] }),
    save: () => ops.push({ op: 'save', args: [] }),
    restore: () => ops.push({ op: 'restore', args: [] }),
    scale: (...args: unknown[]) => ops.push({ op: 'scale', args }),
    setTransform: (...args: unknown[]) => ops.push({ op: 'setTransform', args }),
    createRadialGradient: (...args: unknown[]) => {
      ops.push({ op: 'createRadialGradient', args });
      return { addColorStop: (...stop: unknown[]) => ops.push({ op: 'addColorStop', args: stop }) };
    },
  };
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as HTMLCanvasElement['getContext'];
  return {
    ops,
    lineWidths,
    alphas,
    count: (op: string) => ops.filter((o) => o.op === op).length,
  };
}

// Deterministic rAF: callbacks queue up and are flushed manually.
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;

function installRaf(): void {
  rafCallbacks = new Map();
  nextRafId = 0;
  const schedule = (cb: FrameRequestCallback): number => {
    nextRafId += 1;
    rafCallbacks.set(nextRafId, cb);
    return nextRafId;
  };
  const cancel = (id: number) => {
    rafCallbacks.delete(id);
  };
  vi.stubGlobal('requestAnimationFrame', schedule);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  // The overlay takes rAF from the canvas owner document's window — patch
  // that too so happy-dom's window object is covered by the stub.
  const view = document.defaultView as any;
  if (view && view !== globalThis) {
    view.requestAnimationFrame = schedule;
    view.cancelAnimationFrame = cancel;
  }
}

function flushFrames(max = 1): void {
  for (let i = 0; i < max && rafCallbacks.size > 0; i++) {
    const id = rafCallbacks.keys().next().value as number;
    const cb = rafCallbacks.get(id)!;
    rafCallbacks.delete(id);
    cb(performance.now());
  }
}

const clock = { value: 0 };

/** happy-dom has no layout — hand the element a fixed rect. */
function stubRect(el: HTMLElement, width = 800, height = 600): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
}

interface PointerInit {
  x?: number;
  y?: number;
  pointerType?: string;
  button?: number;
}

function firePointer(target: EventTarget, type: string, opts: PointerInit = {}): PointerEvent {
  const { x = 0, y = 0, pointerType = 'mouse', button = 0 } = opts;
  const Ctor: any = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  if (e.pointerType !== pointerType) {
    Object.defineProperty(e, 'pointerType', { value: pointerType, configurable: true });
  }
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- laser tests

describe('LaserPointerOverlay', () => {
  let container: HTMLElement;
  let rec: Recording;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    rec = installRecordingContext();
    installRaf();
    clock.value = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock.value);
  });

  const create = (opts: LaserPointerOptions = {}) => {
    const laser = new LaserPointerOverlay(container, opts);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    stubRect(canvas);
    return { laser, canvas };
  };

  it('mounts a canvas into the container and stays inert while disabled', () => {
    const { laser, canvas } = create();
    expect(canvas.classList.contains('marp-laser-canvas')).toBe(true);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(laser.isEnabled).toBe(false);
    expect(rafCallbacks.size).toBe(0); // no render loop while disabled
    // Lazy buffer allocation: the backing store is only created on enable(),
    // so the canvas still has its untouched default size here.
    expect(canvas.width).toBe(300);
    laser.disable(); // no-op when already disabled
    expect(rafCallbacks.size).toBe(0);
  });

  it('enable() arms the overlay; disable() restores pass-through and clears', () => {
    const { laser, canvas } = create();
    laser.enable();
    expect(laser.isEnabled).toBe(true);
    expect(canvas.style.pointerEvents).toBe('auto');
    expect(canvas.style.touchAction).toBe('none');
    expect(canvas.style.cursor).toBe('none');

    // Draw something so disable() has state to clear.
    firePointer(canvas, 'pointerdown', { x: 50, y: 50 });
    laser.disable();
    expect(laser.isEnabled).toBe(false);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.style.touchAction).toBe('');
    expect(canvas.style.cursor).toBe('');
    expect(rafCallbacks.size).toBe(0); // rAF cancelled
    expect(rec.count('clearRect')).toBeGreaterThan(0); // canvas wiped
  });

  it('consumes pointer events while enabled so slides never see them', () => {
    const { laser, canvas } = create();
    laser.enable();
    const seen: string[] = [];
    container.addEventListener('pointerdown', () => seen.push('pointerdown'));
    container.addEventListener('click', () => seen.push('click'));

    firePointer(canvas, 'pointerdown', { x: 10, y: 10 });
    firePointer(canvas, 'pointermove', { x: 20, y: 10 });
    firePointer(canvas, 'pointerup', { x: 20, y: 10 });
    firePointer(canvas, 'click', { x: 20, y: 10 });
    expect(seen).toEqual([]);

    // While disabled the guard must not suppress anything.
    laser.disable();
    firePointer(canvas, 'click', { x: 20, y: 10 });
    expect(seen).toEqual(['click']);
  });

  it('notifies onInteract on pointer activity so the host can wake its HUD', () => {
    const onInteract = vi.fn();
    const { laser, canvas } = create({ onInteract });
    laser.enable();

    firePointer(canvas, 'pointermove', { x: 10, y: 10 });
    firePointer(canvas, 'pointerdown', { x: 10, y: 10 });
    expect(onInteract).toHaveBeenCalledTimes(2);

    laser.disable();
    firePointer(canvas, 'pointermove', { x: 20, y: 20 });
    expect(onInteract).toHaveBeenCalledTimes(2); // inert while disabled
  });

  it('draws a velocity-tapered stroke smoothed with quadratic Béziers', () => {
    const { laser, canvas } = create();
    laser.enable();

    firePointer(canvas, 'pointerdown', { x: 100, y: 100 }); // t=0
    clock.value = 100;
    firePointer(canvas, 'pointermove', { x: 110, y: 100 }); // slow: 10px / 100ms
    clock.value = 200;
    firePointer(canvas, 'pointermove', { x: 120, y: 100 }); // slow
    clock.value = 250;
    firePointer(canvas, 'pointermove', { x: 320, y: 100 }); // fast flick: 200px / 50ms
    firePointer(canvas, 'pointerup', { x: 320, y: 100 });

    flushFrames();
    expect(rec.count('quadraticCurveTo')).toBe(3); // one smoothed segment per pair
    expect(rec.lineWidths).toHaveLength(3);
    for (const w of rec.lineWidths) {
      expect(w).toBeGreaterThanOrEqual(2);
      expect(w).toBeLessThanOrEqual(8);
    }
    // Slow segments are near max width, the fast flick tapers thinner.
    expect(rec.lineWidths[0]).toBeGreaterThan(7);
    expect(rec.lineWidths[2]).toBeLessThan(rec.lineWidths[0]);
  });

  it('fades the trail after its lifetime and parks the render loop', () => {
    const { laser, canvas } = create();
    laser.enable();

    firePointer(canvas, 'pointerdown', { x: 100, y: 100 }); // t=0
    clock.value = 100;
    firePointer(canvas, 'pointermove', { x: 140, y: 100 });
    firePointer(canvas, 'pointerup', { x: 140, y: 100 });

    flushFrames(); // frame at t=100: one live segment, loop reschedules
    expect(rec.count('quadraticCurveTo')).toBe(1);
    expect(rafCallbacks.size).toBe(1);

    clock.value = 900; // both points older than the 700ms lifetime
    flushFrames(); // prunes everything, draws nothing, parks
    expect(rec.count('quadraticCurveTo')).toBe(1); // no new segments
    expect(rafCallbacks.size).toBe(0); // loop parked — CPU idle
  });

  it('renders the glowing dot while inside bounds and erases it on leave', () => {
    const { laser, canvas } = create();
    laser.enable();

    firePointer(canvas, 'pointermove', { x: 200, y: 200 });
    flushFrames();
    // Bright solid core (r=4) plus soft glow gradient.
    expect(rec.ops.some((o) => o.op === 'arc' && o.args[2] === 4)).toBe(true);
    expect(rec.count('createRadialGradient')).toBe(1);

    const clearsBefore = rec.count('clearRect');
    firePointer(canvas, 'pointerleave', { x: 200, y: 200 });
    expect(rec.count('clearRect')).toBeGreaterThan(clearsBefore); // dot erased
    expect(rafCallbacks.size).toBe(0); // nothing left to fade
  });

  it('scales the buffer by devicePixelRatio for sharp HiDPI rendering', () => {
    const { laser, canvas } = create();
    const win = canvas.ownerDocument?.defaultView || window;
    Object.defineProperty(win, 'devicePixelRatio', { value: 2, configurable: true });
    try {
      laser.enable(); // enable() re-runs resize()
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1200);
      const transforms = rec.ops.filter((o) => o.op === 'setTransform');
      expect(transforms.length).toBeGreaterThan(0);
      expect(transforms[transforms.length - 1].args).toEqual([2, 0, 0, 2, 0, 0]);
    } finally {
      delete (win as any).devicePixelRatio;
    }
  });

  it('destroy() removes the canvas, cancels the loop, and detaches listeners', () => {
    const { laser, canvas } = create();
    laser.enable();
    laser.destroy();
    expect(container.contains(canvas)).toBe(false);
    expect(rafCallbacks.size).toBe(0);

    // Listeners are gone: events must not restart the loop or throw.
    firePointer(canvas, 'pointermove', { x: 5, y: 5 });
    expect(rafCallbacks.size).toBe(0);
    laser.destroy(); // idempotent
  });
});
