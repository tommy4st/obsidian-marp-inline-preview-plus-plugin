/**
 * Laser pointer math, streamlining, and outline generation.
 * Reference: https://github.com/excalidraw/excalidraw/tree/master/packages/laser-pointer
 */

export type Point = [x: number, y: number, r: number];

export function add([ax, ay, ar]: Point, [bx, by, br]: Point): Point {
  return [ax + bx, ay + by, ar + br];
}

export function sub([ax, ay, ar]: Point, [bx, by, br]: Point): Point {
  return [ax - bx, ay - by, ar - br];
}

export function smul([x, y, r]: Point, s: number): Point {
  return [x * s, y * s, r * s];
}

export function norm([x, y, r]: Point): Point {
  const m = Math.sqrt(x ** 2 + y ** 2);
  return m === 0 ? [0, 0, r] : [x / m, y / m, r];
}

export function rot([x, y, r]: Point, rad: number): Point {
  return [
    Math.cos(rad) * x - Math.sin(rad) * y,
    Math.sin(rad) * x + Math.cos(rad) * y,
    r,
  ];
}

export function plerp(a: Point, b: Point, t: number): Point {
  return add(a, smul(sub(b, a), t));
}

export function angle(p: Point, p1: Point, p2: Point): number {
  return (
    Math.atan2(p2[1] - p[1], p2[0] - p[0]) -
    Math.atan2(p1[1] - p[1], p1[0] - p[0])
  );
}

export function normAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function mag([x, y]: Point): number {
  return Math.sqrt(x ** 2 + y ** 2);
}

export function dist([ax, ay]: Point, [bx, by]: Point): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

export function runLength(ps: Point[]): number {
  if (ps.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < ps.length; i++) {
    len += dist(ps[i - 1], ps[i]);
  }
  return len;
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export function distancePointToSegment(p3: Point, p1: Point, p2: Point): number {
  const sMag = dist(p1, p2);
  if (sMag === 0) return dist(p3, p1);
  const u = clamp(
    ((p3[0] - p1[0]) * (p2[0] - p1[0]) + (p3[1] - p1[1]) * (p2[1] - p1[1])) /
      sMag ** 2,
    0,
    1,
  );
  const pi: Point = [
    p1[0] + u * (p2[0] - p1[0]),
    p1[1] + u * (p2[1] - p1[1]),
    p3[2],
  ];
  return dist(pi, p3);
}

export function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (epsilon === 0 || points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];

  let maxDistance = 0;
  let maxIndex = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distancePointToSegment(points[i], first, last);
    if (d > maxDistance) {
      maxDistance = d;
      maxIndex = i;
    }
  }

  if (maxDistance >= epsilon && maxIndex > 0) {
    const p = points[maxIndex];
    return [
      ...douglasPeucker([first, ...points.slice(1, maxIndex), p], epsilon).slice(0, -1),
      p,
      ...douglasPeucker([p, ...points.slice(maxIndex + 1, -1), last], epsilon).slice(1),
    ];
  }
  return [first, last];
}

export type SizeMappingDetails = {
  pressure: number;
  runningLength: number;
  currentIndex: number;
  totalLength: number;
};

export type LaserPointerOptions = {
  size: number;
  streamline: number;
  simplify: number;
  simplifyPhase: 'tail' | 'output' | 'input';
  keepHead: boolean;
  sizeMapping: (details: SizeMappingDetails) => number;
};

export class LaserPointer {
  static defaults: LaserPointerOptions = {
    size: 3.5,
    streamline: 0.4,
    simplify: 0,
    simplifyPhase: 'output',
    keepHead: false,
    sizeMapping: () => 1,
  };

  static constants = {
    cornerDetectionMaxAngle: 75,
    cornerDetectionVariance: (s: number): number => (s > 35 ? 0.5 : 1),
    maxTailLength: 50,
  };

  options: LaserPointerOptions;
  originalPoints: Point[] = [];

  private stablePoints: Point[] = [];
  private tailPoints: Point[] = [];
  private isFresh = true;

  constructor(options?: Partial<LaserPointerOptions>) {
    this.options = Object.assign({}, LaserPointer.defaults, options);
  }

  private get lastPoint(): Point {
    return (
      this.tailPoints[this.tailPoints.length - 1] ??
      this.stablePoints[this.stablePoints.length - 1]
    );
  }

  addPoint(point: Point): void {
    const lastPoint = this.originalPoints[this.originalPoints.length - 1];
    if (lastPoint && lastPoint[0] === point[0] && lastPoint[1] === point[1]) {
      return;
    }

    this.originalPoints.push(point);

    if (this.isFresh) {
      this.isFresh = false;
      this.stablePoints.push(point);
      return;
    }

    if (this.options.streamline > 0) {
      point = plerp(this.lastPoint, point, 1 - this.options.streamline);
    }

    this.tailPoints.push(point);

    if (runLength(this.tailPoints) > LaserPointer.constants.maxTailLength) {
      this.stabilizeTail();
    }
  }

  close(): void {
    this.stabilizeTail();
  }

  stabilizeTail(): void {
    this.stablePoints.push(...this.tailPoints);
    this.tailPoints = [];
  }

  private getSize(
    sizeOverride: number | undefined,
    pressure: number,
    index: number,
    totalLength: number,
    runningLength: number,
  ): number {
    return (
      (sizeOverride ?? this.options.size) *
      this.options.sizeMapping({
        pressure,
        runningLength,
        currentIndex: index,
        totalLength,
      })
    );
  }

  getStrokeOutline(sizeOverride?: number): Point[] {
    if (this.isFresh) return [];

    let points = [...this.stablePoints, ...this.tailPoints];

    if (this.options.simplify > 0 && this.options.simplifyPhase === 'input') {
      points = douglasPeucker(points, this.options.simplify);
    }

    const len = points.length;
    if (len === 0) return [];

    if (len === 1) {
      const c = points[0];
      const size = this.getSize(sizeOverride, c[2], 0, len, 0);
      if (size < 0.5) return [];

      const ps: Point[] = [];
      for (let theta = 0; theta <= Math.PI * 2; theta += Math.PI / 16) {
        ps.push(add(c, smul(rot([1, 0, 0], theta), size)));
      }
      ps.push(add(c, smul([1, 0, 0], size)));
      return ps;
    }

    if (len === 2) {
      const c = points[0];
      const n = points[1];
      const cSize = this.getSize(sizeOverride, c[2], 0, len, 0);
      const nSize = this.getSize(sizeOverride, n[2], 0, len, 0);
      if (cSize < 0.5 || nSize < 0.5) return [];

      const ps: Point[] = [];
      const pAngle = angle(c, [c[0], c[1] - 100, c[2]], n);
      for (let theta = pAngle; theta <= Math.PI + pAngle; theta += Math.PI / 16) {
        ps.push(add(c, smul(rot([1, 0, 0], theta), cSize)));
      }
      for (let theta = Math.PI + pAngle; theta <= Math.PI * 2 + pAngle; theta += Math.PI / 16) {
        ps.push(add(n, smul(rot([1, 0, 0], theta), nSize)));
      }
      ps.push(ps[0]);
      return ps;
    }

    const forwardPoints: Point[] = [];
    const backwardPoints: Point[] = [];

    let speed = 0;
    let prevSpeed = 0;
    let visibleStartIndex = 0;
    let runningLength = 0;

    for (let i = 1; i < len - 1; i++) {
      const p = points[i - 1];
      const c = points[i];
      const n = points[i + 1];
      const pressure = c[2];

      const d = dist(p, c);
      runningLength += d;
      speed = prevSpeed + (d - prevSpeed) * 0.2;

      const cSize = this.getSize(sizeOverride, pressure, i, len, runningLength);
      if (cSize === 0) {
        visibleStartIndex = i + 1;
        continue;
      }

      const dirPC = norm(sub(p, c));
      const dirNC = norm(sub(n, c));
      const p1dirPC = rot(dirPC, Math.PI / 2);
      const p2dirPC = rot(dirPC, -Math.PI / 2);
      const p1dirNC = rot(dirNC, Math.PI / 2);
      const p2dirNC = rot(dirNC, -Math.PI / 2);

      const p1PC = add(c, smul(p1dirPC, cSize));
      const p2PC = add(c, smul(p2dirPC, cSize));
      const p1NC = add(c, smul(p1dirNC, cSize));
      const p2NC = add(c, smul(p2dirNC, cSize));

      const ftdir = add(p1dirPC, p2dirNC);
      const btdir = add(p2dirPC, p1dirNC);

      const paPC = add(c, smul(mag(ftdir) === 0 ? dirPC : norm(ftdir), cSize));
      const paNC = add(c, smul(mag(btdir) === 0 ? dirNC : norm(btdir), cSize));

      const cAngle = normAngle(angle(c, p, n));
      const D_ANGLE =
        (LaserPointer.constants.cornerDetectionMaxAngle / 180) *
        Math.PI *
        LaserPointer.constants.cornerDetectionVariance(speed);

      if (Math.abs(cAngle) < D_ANGLE) {
        const tAngle = Math.abs(normAngle(Math.PI - cAngle));
        if (tAngle === 0) continue;

        if (cAngle < 0) {
          backwardPoints.push(p2PC, paNC);
          for (let theta = 0; theta <= tAngle; theta += tAngle / 4) {
            forwardPoints.push(add(c, rot(smul(p1dirPC, cSize), theta)));
          }
          for (let theta = tAngle; theta >= 0; theta -= tAngle / 4) {
            backwardPoints.push(add(c, rot(smul(p1dirPC, cSize), theta)));
          }
          backwardPoints.push(paNC, p1NC);
        } else {
          forwardPoints.push(p1PC, paPC);
          for (let theta = 0; theta <= tAngle; theta += tAngle / 4) {
            backwardPoints.push(add(c, rot(smul(p1dirPC, -cSize), -theta)));
          }
          for (let theta = tAngle; theta >= 0; theta -= tAngle / 4) {
            forwardPoints.push(add(c, rot(smul(p1dirPC, -cSize), -theta)));
          }
          forwardPoints.push(paPC, p2NC);
        }
      } else {
        forwardPoints.push(paPC);
        backwardPoints.push(paNC);
      }

      prevSpeed = speed;
    }

    if (visibleStartIndex >= len - 2) {
      if (this.options.keepHead) {
        const c = points[len - 1];
        const headSize = this.getSize(sizeOverride, c[2], len - 1, len, runningLength);
        if (headSize < 0.5) return [];

        const ps: Point[] = [];
        for (let theta = 0; theta <= Math.PI * 2; theta += Math.PI / 16) {
          ps.push(add(c, smul(rot([1, 0, 0], theta), headSize)));
        }
        ps.push(add(c, smul([1, 0, 0], headSize)));
        return ps;
      }
      return [];
    }

    const first = points[visibleStartIndex];
    const second = points[visibleStartIndex + 1];
    const penultimate = points[len - 2];
    const ultimate = points[len - 1];

    const dirFS = norm(sub(second, first));
    const dirPU = norm(sub(penultimate, ultimate));
    const ppdirFS = rot(dirFS, -Math.PI / 2);
    const ppdirPU = rot(dirPU, Math.PI / 2);

    const startCapSize = this.getSize(sizeOverride, first[2], 0, len, 0);
    const startCap: Point[] = [];
    const endCapSize = this.options.keepHead
      ? this.options.size
      : this.getSize(sizeOverride, penultimate[2], len - 2, len, runningLength);
    const endCap: Point[] = [];

    if (startCapSize > 0.1) {
      for (let theta = 0; theta <= Math.PI; theta += Math.PI / 16) {
        startCap.unshift(add(first, rot(smul(ppdirFS, startCapSize), -theta)));
      }
      startCap.unshift(add(first, smul(ppdirFS, -startCapSize)));
    } else {
      startCap.push(first);
    }

    for (let theta = 0; theta <= Math.PI * 3; theta += Math.PI / 16) {
      endCap.push(add(ultimate, rot(smul(ppdirPU, -endCapSize), -theta)));
    }

    const strokeOutline = [
      ...startCap,
      ...forwardPoints,
      ...endCap.reverse(),
      ...backwardPoints.reverse(),
    ];

    if (startCap.length > 0) {
      strokeOutline.push(startCap[0]);
    }

    if (this.options.simplify > 0 && this.options.simplifyPhase === 'output') {
      return douglasPeucker(strokeOutline, this.options.simplify);
    }

    return strokeOutline;
  }
}

/**
 * Creates a fading laser trail instance with full stroke length.
 * @param size Radius of the stroke
 * @param durationSec Duration in seconds before the stroke completely disappears (default: 1.5)
 */
export function createExcalidrawLaserTrail(
  size = 4,
  durationSec = 1.5,
): LaserPointer {
  const decayMs = durationSec * 1000;
  const easeOut = (k: number) => 1 - Math.pow(1 - k, 4);

  return new LaserPointer({
    size,
    streamline: 0.4,
    simplify: 0,
    keepHead: false,
    sizeMapping: (c) =>
      easeOut(Math.max(0, 1 - (performance.now() - c.pressure) / decayMs)),
  });
}
