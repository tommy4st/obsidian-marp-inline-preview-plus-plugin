/**
 * Ephemeral laser pointer overlay for presentation mode.
 *
 * A fullscreen <canvas> mounted inside the presentation root container.
 * Pure DOM + Canvas 2D — no Obsidian imports, so it can be mounted into any
 * container (main window or popout document) and unit-tested in happy-dom.
 *
 * Layering contract: canvas sits at z-index 100 (above slides), the
 * presentation toolbar at z-index 200 (above this canvas).
 *
 * Battery contract: the requestAnimationFrame loop self-parks whenever there
 * is nothing dynamic left to draw (no decaying trail). Any pointer event
 * restarts it. disable()/destroy() cancel it outright.
 */

interface LaserPoint {
  x: number;
  y: number;
  timestamp: number;
  width: number;
}

export interface LaserPointerOptions {
  /** How long a stroke segment stays visible before fading to 0 alpha. */
  trailLifetimeMs?: number;
  /** Stroke width for a slow (near-stationary) hand. */
  maxWidthPx?: number;
  /** Stroke width once speed reaches `speedCeilingPxPerMs`. */
  minWidthPx?: number;
  /** Speed (px/ms) at which the stroke reaches its minimum width. */
  speedCeilingPxPerMs?: number;
  /** Notified whenever the overlay transitions between enabled/disabled. */
  onStateChange?: (enabled: boolean) => void;
  /**
   * Notified on pointer activity while armed. The canvas consumes pointer
   * events (stopPropagation), so the host cannot see them on the container —
   * use this to wake auto-hiding controls (e.g. the presentation HUD).
   */
  onInteract?: () => void;
}

const LASER_COLOR = 'rgb(255, 45, 45)';
const LASER_CORE_COLOR = 'rgb(255, 96, 96)';
const LASER_HOTSPOT_COLOR = 'rgba(255, 236, 236, 0.95)';
const DOT_GLOW_RADIUS = 18;
const DOT_CORE_RADIUS = 4;
const DOT_HOTSPOT_RADIUS = 1.6;
/** New-point weight of the width moving average: prev * 0.6 + target * 0.4. */
const WIDTH_SMOOTHING_NEW = 0.4;
/** Ignore micro-moves so a stationary pointer doesn't bloat the point list. */
const MIN_SEGMENT_DIST = 0.5;

export class LaserPointerOverlay {
  private readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly opts: Required<Omit<LaserPointerOptions, 'onStateChange' | 'onInteract'>> &
    LaserPointerOptions;
  private readonly unsubs: Array<() => void> = [];

  private points: LaserPoint[] = [];
  private rafId = 0;
  private enabled = false;
  private isDrawing = false;
  private pointerInside = false;
  private lastX = 0;
  private lastY = 0;
  private lastWidth: number;
  private cssWidth = 0;
  private cssHeight = 0;
  /** Cached canvas rect so pointer mapping doesn't force layout per move. */
  private bounds: { left: number; top: number } = { left: 0, top: 0 };
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, options: LaserPointerOptions = {}) {
    this.container = container;
    this.opts = {
      trailLifetimeMs: options.trailLifetimeMs ?? 700,
      maxWidthPx: options.maxWidthPx ?? 8,
      minWidthPx: options.minWidthPx ?? 2,
      speedCeilingPxPerMs: options.speedCeilingPxPerMs ?? 2,
      onStateChange: options.onStateChange,
      onInteract: options.onInteract,
    };
    this.lastWidth = this.opts.maxWidthPx;

    const doc = container.ownerDocument || document;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'marp-laser-canvas';
    this.canvas.style.pointerEvents = 'none'; // inert until enable()
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.listen(this.canvas, 'pointerdown', this.onPointerDown);
    this.listen(this.canvas, 'pointermove', this.onPointerMove);
    this.listen(this.canvas, 'pointerup', this.onPointerUp);
    this.listen(this.canvas, 'pointercancel', this.onPointerUp);
    this.listen(this.canvas, 'pointerleave', this.onPointerLeave);
    // Suppress synthesized click/context menu so slide navigation never fires
    // while the laser is armed.
    this.listen(this.canvas, 'click', this.suppressEvent);
    this.listen(this.canvas, 'contextmenu', this.suppressEvent);
    this.listen(this.canvas, 'touchstart', this.suppressEvent, { passive: false });
    this.listen(this.canvas, 'touchmove', this.suppressEvent, { passive: false });
    this.listen(this.canvas, 'touchend', this.suppressEvent, { passive: false });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      this.unsubs.push(() => this.resizeObserver?.disconnect());
    }
    const win = doc.defaultView || window;
    this.listen(win, 'resize', this.resize);

    this.resize();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.canvas.style.pointerEvents = 'auto';
    // CRITICAL on Obsidian Mobile: without touch-action:none the WebView
    // interprets strokes as swipe-to-reveal-sidebar / pull-to-search gestures.
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'none';
    this.resize();
    this.ensureLoop();
    this.opts.onStateChange?.(true);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.touchAction = '';
    this.canvas.style.cursor = '';
    this.cancelLoop();
    this.points = [];
    this.isDrawing = false;
    this.pointerInside = false;
    this.clearCanvas();
    this.opts.onStateChange?.(false);
  }

  /** Remove the canvas, cancel the loop and detach every listener. Idempotent. */
  destroy(): void {
    this.disable();
    for (const off of this.unsubs.splice(0)) off();
    this.canvas.remove();
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.unsubs.push(() => target.removeEventListener(type, handler, options));
  }

  // ---------------------------------------------------------------- render loop

  /**
   * The window whose rendering pipeline owns this canvas. Plugin code runs in
   * the main window's JS context even when the presentation DOM lives in a
   * popout window — and the main window is occluded (behind the presentation),
   * so its requestAnimationFrame is throttled to ~1Hz. The rAF must come from
   * the canvas's own window or the overlay freezes.
   */
  private get rafWin(): Window {
    return this.canvas.ownerDocument?.defaultView || window;
  }

  private ensureLoop(): void {
    if (this.rafId || !this.enabled) return;
    this.rafId = this.rafWin.requestAnimationFrame(this.renderFrame);
  }

  private cancelLoop(): void {
    if (this.rafId) {
      this.rafWin.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private renderFrame = (): void => {
    this.rafId = 0;
    if (!this.enabled) return;
    const now = performance.now();
    this.prunePoints(now);
    this.draw(now);
    if (this.points.length > 0) {
      this.rafId = this.rafWin.requestAnimationFrame(this.renderFrame);
    }
    // else: park. The canvas keeps the static laser dot (if any); the next
    // pointer event restarts the loop.
  };

  private prunePoints(now: number): void {
    const cutoff = now - this.opts.trailLifetimeMs;
    let drop = 0;
    while (drop < this.points.length && this.points[drop].timestamp <= cutoff) drop++;
    if (drop > 0) this.points.splice(0, drop);
  }

  private clearCanvas(): void {
    this.ctx?.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawTrail(ctx, now);
    if (this.pointerInside) this.drawDot(ctx);
  }

  /** Fading, velocity-tapered stroke drawn as midpoint quadratic Béziers. */
  private drawTrail(ctx: CanvasRenderingContext2D, now: number): void {
    const pts = this.points;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      // A tap without movement: render a small fading mark.
      const p = pts[0];
      const alpha = this.segmentAlpha(p.timestamp, now);
      if (alpha > 0) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = LASER_COLOR;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = LASER_COLOR;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const alpha = this.segmentAlpha(curr.timestamp, now);
      if (alpha <= 0) continue;
      // Each segment spans the midpoint of the previous pair to the midpoint
      // of this pair, curved through the shared point — the classic smoothed
      // polyline. The final segment extends to the tip so strokes end exactly
      // at the pointer.
      const startX = i >= 2 ? (pts[i - 2].x + prev.x) / 2 : prev.x;
      const startY = i >= 2 ? (pts[i - 2].y + prev.y) / 2 : prev.y;
      const isLast = i === pts.length - 1;
      const endX = isLast ? curr.x : (prev.x + curr.x) / 2;
      const endY = isLast ? curr.y : (prev.y + curr.y) / 2;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = curr.width;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(prev.x, prev.y, endX, endY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private segmentAlpha(timestamp: number, now: number): number {
    const life = Math.max(1, now - timestamp);
    return Math.max(0, Math.min(1, 1 - life / this.opts.trailLifetimeMs));
  }

  /** Glowing red dot: soft radial falloff + bright solid core + hot center. */
  private drawDot(ctx: CanvasRenderingContext2D): void {
    const { lastX: x, lastY: y } = this;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, DOT_GLOW_RADIUS);
    glow.addColorStop(0, 'rgba(255, 45, 45, 0.55)');
    glow.addColorStop(0.45, 'rgba(255, 45, 45, 0.22)');
    glow.addColorStop(1, 'rgba(255, 45, 45, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, DOT_GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = LASER_CORE_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, DOT_CORE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = LASER_HOTSPOT_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, DOT_HOTSPOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // -------------------------------------------------------------------- events

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.stopPropagation();
    e.preventDefault();
    this.opts.onInteract?.();
    this.updatePointerPosition(e);
    this.pointerInside = true;
    this.isDrawing = e.button === 0 || e.pointerType !== 'mouse';
    this.lastWidth = this.opts.maxWidthPx;
    if (this.isDrawing) this.pushPoint(this.lastX, this.lastY, performance.now());
    try {
      // Keep receiving moves if the pointer briefly leaves the canvas mid-stroke.
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {}
    this.ensureLoop();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.stopPropagation();
    this.opts.onInteract?.();
    this.updatePointerPosition(e);
    this.pointerInside = this.isWithinBounds(this.lastX, this.lastY);
    if (this.isDrawing && this.pointerInside) this.recordStrokePoint(performance.now());
    this.ensureLoop();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.stopPropagation();
    this.isDrawing = false;
    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {}
    this.ensureLoop(); // let the remaining trail decay before parking
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.stopPropagation();
    this.pointerInside = false;
    this.isDrawing = false;
    if (this.points.length > 0) this.ensureLoop();
    else this.clearCanvas(); // erase the dot immediately; nothing left to fade
  };

  private suppressEvent = (e: Event): void => {
    if (!this.enabled) return;
    e.stopPropagation();
    e.preventDefault();
  };

  // ------------------------------------------------------------------- geometry

  private recordStrokePoint(now: number): void {
    const last = this.points[this.points.length - 1];
    if (last) {
      const dist = Math.hypot(this.lastX - last.x, this.lastY - last.y);
      if (dist < MIN_SEGMENT_DIST) return;
      // Velocity → width: slow hand → wide, fast hand → thin. Guard dt so a
      // same-frame burst never divides by ~0 and spikes the speed.
      const dt = Math.max(now - last.timestamp, 1);
      const speed = dist / dt;
      const t = Math.min(speed / this.opts.speedCeilingPxPerMs, 1);
      const range = this.opts.maxWidthPx - this.opts.minWidthPx;
      const target = this.opts.maxWidthPx - range * t;
      this.lastWidth = this.lastWidth * 0.6 + target * 0.4;
    } else {
      this.lastWidth = this.opts.maxWidthPx;
    }
    this.pushPoint(this.lastX, this.lastY, now);
  }

  private pushPoint(x: number, y: number, timestamp: number): void {
    this.points.push({ x, y, timestamp, width: this.lastWidth });
  }

  private updatePointerPosition(e: { clientX: number; clientY: number }): void {
    this.lastX = e.clientX - this.bounds.left;
    this.lastY = e.clientY - this.bounds.top;
  }

  private isWithinBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x <= this.cssWidth && y <= this.cssHeight;
  }

  /**
   * Sync the canvas buffer with the container size and devicePixelRatio so
   * strokes stay sharp on Retina/mobile screens. Drawing coordinates remain
   * in CSS pixels via the ctx transform.
   */
  private resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const win = this.canvas.ownerDocument?.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.bounds = { left: rect.left, top: rect.top };
    // Buffer allocation is deferred until the overlay is armed. Assigning
    // canvas.width is what forces Chromium to create/activate the compositor
    // layer; allocating at construction time (never painted) left the layer
    // dormant on Linux/Electron — first-enable paints stayed invisible until
    // an app switch forced a recomposite.
    if (!this.enabled) return;
    // Never allocate a 0×0 buffer (detached/hidden layouts report 0).
    const bufferW = Math.max(1, Math.round(rect.width * dpr));
    const bufferH = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== bufferW) this.canvas.width = bufferW;
    if (this.canvas.height !== bufferH) this.canvas.height = bufferH;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A buffer resize wipes the bitmap — repaint the live state.
    if (this.pointerInside || this.points.length > 0) this.ensureLoop();
  };
}
