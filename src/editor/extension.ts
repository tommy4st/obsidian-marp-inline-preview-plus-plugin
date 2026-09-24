import { App, MarkdownView, TFile } from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { MarpEngine } from '../marp/engine';
import { resolveThemeAndMd, type ThemeResolver } from '../marp/themes';
import { findSlideBreaks, type LineRange } from '../marp/slides';
import { SlidePlaceholder } from './widget';
import { SlideStage, type SlideContent } from './stage';
import { debounce } from '../util/debounce';
import { rewriteImageSrcs, rewriteCssUrls } from '../util/images';
import type { EditPreviewPosition } from '../settings';

export type EditorDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
  debounceMs: () => number;
  previewPosition?: () => EditPreviewPosition;
};

/**
 * Effect used by the rebuild ViewPlugin to push a fresh DecorationSet into
 * the StateField below. Using an explicit effect (rather than mutating a
 * ViewPlugin field) is what makes CM6 reliably re-render the widgets — empty
 * dispatches do not invalidate decoration facets.
 */
const setSlides = StateEffect.define<DecorationSet>();

/**
 * External nudge effect: dispatch `refreshSlides.of(null)` to an editor to
 * force the worker to recompute decorations (e.g. after settings change or
 * after a theme CSS file was modified).
 */
export const refreshSlides = StateEffect.define<null>();

const slidesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // Shift existing widget positions when the user edits, so they don't
    // visually jump until the rebuild ViewPlugin recomputes them.
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSlides)) value = effect.value;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Build slide placeholder decorations according to the configured position.
 */
export function createSlideDecorations(
  slidesCount: number,
  breaks: LineRange[] & { bodyStart?: number },
  docLength: number,
  position: EditPreviewPosition = 'before-divider',
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (slidesCount === 0) return builder.finish();

  const add = (idx: number, pos: number, side: number) =>
    builder.add(pos, pos, Decoration.widget({ widget: new SlidePlaceholder(idx), block: true, side }));

  if (position === 'top') {
    const bodyStart = breaks.bodyStart ?? 0;
    add(0, bodyStart, bodyStart > 0 ? 1 : -1);
    const count = Math.min(breaks.length, slidesCount - 1);
    for (let i = 0; i < count; i++) add(i + 1, breaks[i].to, 1);
  } else {
    const isBefore = position === 'before-divider';
    const count = Math.min(breaks.length, slidesCount);
    for (let i = 0; i < count; i++) {
      add(i, isBefore ? breaks[i].from : breaks[i].to, isBefore ? -1 : 1);
    }
    if (slidesCount > breaks.length) {
      add(slidesCount - 1, docLength, 1);
    }
  }

  return builder.finish();
}

/**
 * Build the editor extension bundle: a StateField that holds slide
 * decorations plus a worker ViewPlugin that rebuilds them on doc changes.
 */
export function buildEditorExtension(deps: EditorDeps): Extension {
  const worker = ViewPlugin.fromClass(
    class {
      private destroyed = false;
      private latestRunId = 0;
      private schedule: () => void;
      private stage: SlideStage;

      constructor(public view: EditorView) {
        this.stage = new SlideStage(view);
        this.schedule = debounce(() => {
          if (this.destroyed) return;
          void this.rebuild();
        }, Math.max(50, deps.debounceMs()));
        // Initial render: defer one tick so the leaf has time to attach the
        // file to the editor, then rebuild immediately (no debounce delay).
        setTimeout(() => {
          if (!this.destroyed) void this.rebuild();
        }, 0);
      }

      update(u: ViewUpdate): void {
        // Any layout-affecting update needs an iframe reposition pass, even
        // if nothing about the slide content changed (scroll, pane resize,
        // viewport cull/uncull, etc.).
        if (u.docChanged || u.viewportChanged || u.geometryChanged) {
          this.stage.scheduleReposition();
        }
        if (u.docChanged) {
          this.schedule();
          return;
        }
        // External refresh request from main.ts (theme file change, settings,
        // metadataCache update, etc.) — bypass the debounce.
        for (const tr of u.transactions) {
          for (const e of tr.effects) {
            if (e.is(refreshSlides)) {
              void this.rebuild();
              return;
            }
          }
        }
      }

      destroy(): void {
        this.destroyed = true;
        this.stage.destroy();
      }

      private clear(): void {
        this.stage.syncSlides([]);
        this.push(Decoration.none);
      }

      async rebuild(): Promise<void> {
        if (!deps.enabled()) {
          this.clear();
          return;
        }

        const runId = ++this.latestRunId;
        const file = resolveFile(deps.app, this.view);
        if (!file) {
          this.clear();
          return;
        }

        const cache = deps.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter ?? {};
        if (fm.marp !== true && fm.marp !== 'true') {
          this.clear();
          return;
        }

        try {
          const rawSrc = this.view.state.doc.toString();
          const { md: mdForMarp } = await resolveThemeAndMd(deps.themes, file, rawSrc, fm);
          if (runId !== this.latestRunId || this.destroyed) return;

          const rendered = deps.engine.renderArray(mdForMarp);
          const fullCss = rewriteCssUrls(rendered.css, file.path, deps.app);
          const slides: SlideContent[] = rendered.html.map((h) => ({
            html: rewriteImageSrcs(h, file.path, deps.app),
            css: fullCss,
          }));
          const breaks = findSlideBreaks(rawSrc);

          // Update iframe contents first so the iframes have the new HTML by
          // the time CM6 finishes mounting placeholders and we read their
          // positions in the measure phase.
          this.stage.syncSlides(slides);

          this.push(
            createSlideDecorations(
              slides.length,
              breaks,
              this.view.state.doc.length,
              deps.previewPosition?.() ?? 'before-divider',
            ),
          );
          this.stage.scheduleReposition();
        } catch (e) {
          console.error('[marp-inline-preview] edit-mode render failed', e);
          this.stage.syncSlides([]);
          this.push(Decoration.none);
        }
      }

      private push(decorations: DecorationSet): void {
        if (this.destroyed) return;
        this.view.dispatch({ effects: setSlides.of(decorations) });
      }
    },
  );

  return [slidesField, worker];
}

function resolveFile(app: App, view: EditorView): TFile | null {
  let found: TFile | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    const v = leaf.view;
    if (v instanceof MarkdownView) {
      // @ts-expect-error — `editor.cm` is not part of the public API but is the
      // standard escape hatch used by editor-extension plugins.
      const cm = v.editor?.cm as EditorView | undefined;
      if (cm === view && v.file) found = v.file;
    }
  });
  return found ?? app.workspace.getActiveFile();
}
