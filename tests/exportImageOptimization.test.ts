import { describe, it, expect } from 'vitest';
import { QUALITY_PRESETS } from '../src/export/printer';

describe('Image Optimization Quality Presets', () => {
  it('defines valid dimensions and quality ratios for high, medium, and low', () => {
    expect(QUALITY_PRESETS.high.maxDimension).toBe(3840);
    expect(QUALITY_PRESETS.high.quality).toBe(0.85);

    expect(QUALITY_PRESETS.medium.maxDimension).toBe(1920);
    expect(QUALITY_PRESETS.medium.quality).toBe(0.8);

    expect(QUALITY_PRESETS.low.maxDimension).toBe(1280);
    expect(QUALITY_PRESETS.low.quality).toBe(0.7);
  });

});
