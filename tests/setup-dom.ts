// Setup file loaded by vitest for happy-dom suites. Provides the Obsidian
// runtime globals (createEl, createDiv) that the plugin uses but doesn't
// import — Obsidian injects these on `window` at startup, so production
// code references them without an import statement.

type CreateElOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

function applyOptions(el: HTMLElement, opts?: CreateElOptions) {
  if (!opts) return;
  if (opts.cls) {
    const classes = Array.isArray(opts.cls) ? opts.cls : [opts.cls];
    for (const c of classes) el.classList.add(c);
  }
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  }
}

const g = globalThis as unknown as {
  createEl?: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOptions,
  ) => HTMLElementTagNameMap[K];
  createDiv?: (opts?: CreateElOptions) => HTMLDivElement;
  createSpan?: (opts?: CreateElOptions) => HTMLSpanElement;
};

g.createEl = function createEl(tag, opts) {
  const el = document.createElement(tag);
  applyOptions(el, opts);
  return el;
};

g.createDiv = function createDiv(opts) {
  return g.createEl!('div', opts);
};

g.createSpan = function createSpan(opts) {
  return g.createEl!('span', opts);
};

if (typeof Element !== 'undefined') {
  const proto = Element.prototype as any;
  if (!proto.empty) {
    proto.empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!proto.addClass) {
    proto.addClass = function (...cls: string[]) {
      this.classList.add(...cls);
    };
  }
  if (!proto.removeClass) {
    proto.removeClass = function (...cls: string[]) {
      this.classList.remove(...cls);
    };
  }
  if (!proto.toggleClass) {
    proto.toggleClass = function (cls: string, val?: boolean) {
      return this.classList.toggle(cls, val);
    };
  }
  if (!proto.createEl) {
    proto.createEl = function (tag: any, opts: any) {
      const el = g.createEl!(tag, opts);
      this.appendChild(el);
      return el;
    };
  }
  if (!proto.createDiv) {
    proto.createDiv = function (opts: any) {
      return this.createEl('div', opts);
    };
  }
  if (!proto.createSpan) {
    proto.createSpan = function (opts: any) {
      return this.createEl('span', opts);
    };
  }
  if (!proto.setText) {
    proto.setText = function (val: string) {
      this.textContent = val;
    };
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
    if (type === '2d') {
      return {
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        arc: () => {},
        fill: () => {},
        save: () => {},
        restore: () => {},
        scale: () => {},
      };
    }
    return orig?.call(this, type, ...args);
  };
}
