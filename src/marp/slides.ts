// Locate Marp slide-break positions in a markdown source string.
//
// Marpit defines a slide break as a line consisting of `---` (three or more
// hyphens) that is not inside a fenced code block and not the frontmatter
// delimiters at the top of the document.

export type LineRange = { from: number; to: number; lineNumber: number };
export type SlideBreaks = LineRange[] & { bodyStart?: number };

const FENCE_RE = /^(```+|~~~+)/;
const BREAK_RE = /^-{3,}\s*$/;
const BACKTICK_CLOSE_RE = /^`{3,}\s*$/;
const TILDE_CLOSE_RE = /^~{3,}\s*$/;

export function findSlideBreaks(source: string): SlideBreaks {
  const breaks: SlideBreaks = [];
  let offset = 0;
  let inFence = false;
  let fenceMarker: string | null = null;
  let lineNumber = 0;
  let frontmatterOpen = false;
  let frontmatterClosed = false;
  let sawNonEmptyBeforeFm = false;

  const lines = source.split('\n');
  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    const trimmed = line.replace(/\r$/, '');

    // Fence tracking (open/close)
    if (!inFence) {
      const m = FENCE_RE.exec(trimmed);
      if (m) {
        inFence = true;
        fenceMarker = m[1][0]; // ` or ~
      }
    } else if (fenceMarker) {
      const closeRe = fenceMarker === '`' ? BACKTICK_CLOSE_RE : TILDE_CLOSE_RE;
      if (closeRe.test(trimmed)) {
        inFence = false;
        fenceMarker = null;
      }
    }

    // Frontmatter handling: only when the very first non-empty line is `---`
    if (!frontmatterClosed) {
      if (!frontmatterOpen) {
        if (trimmed.length === 0) {
          // ignore leading blank lines
        } else if (!sawNonEmptyBeforeFm && BREAK_RE.test(trimmed)) {
          frontmatterOpen = true;
          sawNonEmptyBeforeFm = true;
          offset = end + 1;
          lineNumber++;
          continue;
        } else {
          sawNonEmptyBeforeFm = true;
          frontmatterClosed = true;
        }
      } else if (BREAK_RE.test(trimmed)) {
        frontmatterClosed = true;
        breaks.bodyStart = end;
        offset = end + 1;
        lineNumber++;
        continue;
      }
    }

    if (!inFence && frontmatterClosed && BREAK_RE.test(trimmed)) {
      breaks.push({ from: start, to: end, lineNumber });
    }

    offset = end + 1; // +1 for the \n
    lineNumber++;
  }

  return breaks;
}
