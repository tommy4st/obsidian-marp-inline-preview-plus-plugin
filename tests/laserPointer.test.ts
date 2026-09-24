import { describe, it, expect } from 'vitest';
import {
  LaserPointer,
  createExcalidrawLaserTrail,
  add,
  sub,
  smul,
  norm,
  rot,
  plerp,
  dist,
  normAngle,
  runLength,
  douglasPeucker,
} from '../src/presentation/laserPointer';

describe('LaserPointer Math & Outline', () => {
  it('performs vector operations accurately', () => {
    expect(add([1, 2, 0], [3, 4, 0])).toEqual([4, 6, 0]);
    expect(sub([5, 6, 0], [2, 1, 0])).toEqual([3, 5, 0]);
    expect(smul([2, 3, 0], 2)).toEqual([4, 6, 0]);
    expect(dist([0, 0, 0], [3, 4, 0])).toBe(5);

    const unit = norm([3, 4, 0]);
    expect(unit[0]).toBeCloseTo(0.6);
    expect(unit[1]).toBeCloseTo(0.8);

    const rotated = rot([1, 0, 0], Math.PI / 2);
    expect(rotated[0]).toBeCloseTo(0);
    expect(rotated[1]).toBeCloseTo(1);

    const lerped = plerp([0, 0, 0], [10, 10, 0], 0.5);
    expect(lerped[0]).toBe(5);
    expect(lerped[1]).toBe(5);

    expect(normAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(runLength([[0, 0, 0], [3, 4, 0]])).toBe(5);
    expect(runLength([[0, 0, 0], [3, 4, 0], [3, 4, 0]])).toBe(5);
    expect(runLength([[0, 0, 0], [3, 4, 0], [6, 8, 0]])).toBe(10);
  });

  it('simplifies lines using douglasPeucker', () => {
    const straight = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 2, 0],
      [3, 3, 0],
    ] as any;
    const simplified = douglasPeucker(straight, 0.1);
    expect(simplified.length).toBe(2);
    expect(simplified[0]).toEqual([0, 0, 0]);
    expect(simplified[1]).toEqual([3, 3, 0]);
  });

  it('handles empty, 1, 2, and N points in LaserPointer without throwing', () => {
    const lp = new LaserPointer({ size: 4 });
    expect(lp.getStrokeOutline()).toEqual([]);

    lp.addPoint([50, 50, performance.now()]);
    const outline1 = lp.getStrokeOutline();
    expect(outline1.length).toBeGreaterThan(0);

    lp.addPoint([60, 60, performance.now()]);
    const outline2 = lp.getStrokeOutline();
    expect(outline2.length).toBeGreaterThan(0);

    for (let i = 2; i < 20; i++) {
      lp.addPoint([50 + i * 5, 50 + i * 5, performance.now()]);
    }
    lp.close();
    const outlineN = lp.getStrokeOutline();
    expect(outlineN.length).toBeGreaterThan(10);
    // Closed polygon outline check
    expect(outlineN[0][0]).toBeCloseTo(outlineN[outlineN.length - 1][0]);
    expect(outlineN[0][1]).toBeCloseTo(outlineN[outlineN.length - 1][1]);
  });

  it('creates full-length trail that renders and completely decays without lingering dots', () => {
    const trail = createExcalidrawLaserTrail(4, 0.5);
    const now = performance.now();
    for (let i = 0; i < 50; i++) {
      trail.addPoint([100 + i * 2, 100 + i * 2, now]);
    }
    expect(trail.getStrokeOutline().length).toBeGreaterThan(0);

    const expired = createExcalidrawLaserTrail(4, 0.5);
    const t0 = performance.now() - 1000;
    for (let i = 0; i < 10; i++) {
      expired.addPoint([100 + i * 5, 100 + i * 5, t0 + i * 10]);
    }
    expired.close();
    expect(expired.getStrokeOutline().length).toBe(0);
  });
});
