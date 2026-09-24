import { describe, it, expect } from 'vitest';
import { findSlideBreaks } from '../src/marp/slides';

describe('findSlideBreaks', () => {
  it('returns no breaks for content without slide separators', () => {
    expect(findSlideBreaks('one line\nanother line\n')).toEqual([]);
  });

  it('returns one break per `---` line in body', () => {
    const src = 'slide one\n\n---\n\nslide two\n\n---\n\nslide three\n';
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(2);
    expect(breaks.map((b) => b.lineNumber)).toEqual([2, 6]);
  });

  it('treats the opening and closing `---` of frontmatter as non-breaks', () => {
    const src = '---\nmarp: true\n---\n\nbody\n\n---\n\nslide two\n';
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].lineNumber).toBe(6);
  });

  it('does not require frontmatter to be present', () => {
    const src = 'no frontmatter at all\n\n---\n\nsecond slide\n';
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
  });

  it('ignores `---` inside ``` fenced code blocks', () => {
    const src = ['intro', '', '```', '---', '```', '', 'body', '', '---', '', 'next', ''].join('\n');
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].lineNumber).toBe(8);
  });

  it('ignores `---` inside ~~~ fenced code blocks', () => {
    const src = ['~~~yaml', '---', '~~~', '', '---', ''].join('\n');
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].lineNumber).toBe(4);
  });

  it('accepts CRLF line endings', () => {
    const src = 'one\r\n\r\n---\r\n\r\ntwo\r\n';
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
  });

  it('accepts more than three hyphens', () => {
    const src = 'a\n\n-----\n\nb\n';
    const breaks = findSlideBreaks(src);
    expect(breaks).toHaveLength(1);
  });

  it('rejects lines like `--` (too short) and `--- text` (non-blank)', () => {
    const src = ['a', '', '--', '', '--- not a break', '', 'b'].join('\n');
    expect(findSlideBreaks(src)).toEqual([]);
  });

  it('returns from/to byte offsets that point at the `---` line', () => {
    const src = 'one\n---\ntwo\n';
    const [brk] = findSlideBreaks(src);
    expect(src.slice(brk.from, brk.to)).toBe('---');
  });

  it('tracks bodyStart at frontmatter close when frontmatter is present', () => {
    const src = '---\nmarp: true\n---\n\nslide 1\n---\nslide 2';
    const breaks = findSlideBreaks(src);
    expect(breaks.bodyStart).toBe(18);
    expect(src.slice(0, breaks.bodyStart)).toBe('---\nmarp: true\n---');
    expect(breaks).toHaveLength(1);
  });

  it('leaves bodyStart undefined when frontmatter is absent', () => {
    const src = 'slide 1\n---\nslide 2';
    const breaks = findSlideBreaks(src);
    expect(breaks.bodyStart).toBeUndefined();
    expect(breaks).toHaveLength(1);
  });
});
