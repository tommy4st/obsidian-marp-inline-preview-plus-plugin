import { describe, it, expect } from 'vitest';
import { findSlideBreaks } from '../src/marp/slides';
import { createSlideDecorations } from '../src/editor/extension';
import type { DecorationSet } from '@codemirror/view';

function collectWidgets(decorations: DecorationSet, docLength: number) {
  const widgets: { from: number; to: number; index: number; side: number }[] = [];
  decorations.between(0, docLength, (from, to, value) => {
    widgets.push({
      from,
      to,
      index: (value.spec.widget as any).index,
      side: value.spec.side,
    });
  });
  return widgets;
}

describe('createSlideDecorations', () => {
  const twoSlideDoc = '---\nmarp: true\n---\n# Slide 1\n---\n# Slide 2\n';

  describe('before-divider position', () => {
    it('places slide preview before each divider and at the end of the document for the last slide', () => {
      const breaks = findSlideBreaks(twoSlideDoc);
      const widgets = collectWidgets(
        createSlideDecorations(2, breaks, twoSlideDoc.length, 'before-divider'),
        twoSlideDoc.length,
      );

      expect(widgets).toHaveLength(2);
      // Slide 0 placed right before the first divider
      expect(widgets[0].index).toBe(0);
      expect(widgets[0].from).toBe(breaks[0].from);
      expect(widgets[0].side).toBe(-1);

      // Slide 1 placed at document end
      expect(widgets[1].index).toBe(1);
      expect(widgets[1].from).toBe(twoSlideDoc.length);
      expect(widgets[1].side).toBe(1);
    });

    it('places single slide preview at doc end when there are no dividers', () => {
      const singleDoc = '---\nmarp: true\n---\n# Only Slide\n';
      const breaks = findSlideBreaks(singleDoc);
      const widgets = collectWidgets(
        createSlideDecorations(1, breaks, singleDoc.length, 'before-divider'),
        singleDoc.length,
      );

      expect(widgets).toHaveLength(1);
      expect(widgets[0].index).toBe(0);
      expect(widgets[0].from).toBe(singleDoc.length);
    });
  });

  describe('after-divider position', () => {
    it('places slide preview after each divider line', () => {
      const breaks = findSlideBreaks(twoSlideDoc);
      const widgets = collectWidgets(
        createSlideDecorations(2, breaks, twoSlideDoc.length, 'after-divider'),
        twoSlideDoc.length,
      );

      expect(widgets).toHaveLength(2);
      // Slide 0 placed right after the first divider
      expect(widgets[0].index).toBe(0);
      expect(widgets[0].from).toBe(breaks[0].to);
      expect(widgets[0].side).toBe(1);

      // Slide 1 placed at doc end
      expect(widgets[1].index).toBe(1);
      expect(widgets[1].from).toBe(twoSlideDoc.length);
      expect(widgets[1].side).toBe(1);
    });
  });

  describe('top position', () => {
    it('places slide 0 at end of frontmatter and subsequent slides after each break divider', () => {
      const breaks = findSlideBreaks(twoSlideDoc);
      const widgets = collectWidgets(
        createSlideDecorations(2, breaks, twoSlideDoc.length, 'top'),
        twoSlideDoc.length,
      );

      expect(widgets).toHaveLength(2);
      // Slide 0 placed at top of slide (after frontmatter closing ---)
      expect(widgets[0].index).toBe(0);
      expect(widgets[0].from).toBe(breaks.bodyStart);
      expect(widgets[0].side).toBe(1);

      // Slide 1 placed at top of slide 1 (right after the divider)
      expect(widgets[1].index).toBe(1);
      expect(widgets[1].from).toBe(breaks[0].to);
      expect(widgets[1].side).toBe(1);
    });

    it('places slide 0 at offset 0 when there is no frontmatter', () => {
      const noFmDoc = '# Slide 1\n---\n# Slide 2\n';
      const breaks = findSlideBreaks(noFmDoc);
      const widgets = collectWidgets(
        createSlideDecorations(2, breaks, noFmDoc.length, 'top'),
        noFmDoc.length,
      );

      expect(widgets).toHaveLength(2);
      expect(widgets[0].index).toBe(0);
      expect(widgets[0].from).toBe(0);
      expect(widgets[0].side).toBe(-1);

      expect(widgets[1].index).toBe(1);
      expect(widgets[1].from).toBe(breaks[0].to);
    });
  });
});
