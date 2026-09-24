import { ItemView, TFile, setIcon } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import { resolveThemeAndMd } from '../marp/themes';
import { rewriteCssUrls, rewriteImageSrcs } from '../util/images';
import { SLIDE_H, SLIDE_W, createBaseIframe, paintFrame } from '../util/frame';
import { PresentationSession } from './session';

export const MARP_PRESENTATION_VIEW_TYPE = 'marp-presentation-view';
export const MARP_PRESENTER_VIEW_TYPE = 'marp-presenter-view';

export const PRESENTATION_CHANNEL_NAME = 'obsidian-marp-presentation-sync';

export interface PresentationTimerState {
  isRunning: boolean;
  elapsedSeconds: number;
  startedAt: number | null;
}

export interface PresentationState {
  filePath: string;
  currentSlide: number;
  totalSlides: number;
  isBlackout: boolean;
  isWhiteout: boolean;
  timer: PresentationTimerState;
}

export interface SlideDeckData {
  slides: string[];
  css: string;
  comments: string[][];
  title?: string;
}

export type PresentationMessage =
  | { type: 'NAVIGATE'; filePath: string; slideIndex: number }
  | { type: 'TIMER_CONTROL'; action: 'start' | 'pause' | 'reset' }
  | { type: 'SET_BLANK'; blank: 'none' | 'black' | 'white' }
  | { type: 'SYNC_REQUEST' }
  | { type: 'SYNC_RESPONSE'; state: PresentationState };

export function safePaintFrame(iframe: HTMLIFrameElement, html: string, css: string): void {
  if (!paintFrame(iframe, html, css)) {
    // Retry on the iframe's own window: the presentation may live in a popout,
    // and the main window's rAF is throttled to ~1Hz while that popout covers it.
    const win = iframe.ownerDocument?.defaultView || window;
    win.requestAnimationFrame(() => {
      if (!paintFrame(iframe, html, css)) {
        setTimeout(() => paintFrame(iframe, html, css), 60);
      }
    });
  }
}

export async function loadSlideDeck(plugin: MarpInlinePreviewPlugin, file: TFile): Promise<SlideDeckData> {
  const src = await plugin.app.vault.cachedRead(file);
  const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
  const { md } = await resolveThemeAndMd(plugin.themes, file, src, fm);
  const rendered = plugin.engine.renderArray(md);
  return {
    slides: rendered.html.map((h) => rewriteImageSrcs(h, file.path, plugin.app)),
    css: rewriteCssUrls(rendered.css, file.path, plugin.app),
    comments: rendered.comments,
    title: typeof fm?.title === 'string' ? fm.title : file.basename,
  };
}

export async function initializeDeckSession(
  plugin: MarpInlinePreviewPlugin,
  file: TFile,
  existingSession: PresentationSession | null,
  initialSlideIndex?: number,
  onAttach?: (session: PresentationSession) => void,
): Promise<{ deck: SlideDeckData; session: PresentationSession }> {
  const deck = await loadSlideDeck(plugin, file);
  let session = existingSession;
  if (!session) {
    session = PresentationSession.getOrCreate(file.path, deck.slides.length);
    if (initialSlideIndex !== undefined && initialSlideIndex >= 0) {
      session.goTo(initialSlideIndex, false);
    }
    if (onAttach) onAttach(session);
  } else {
    session.setTotalSlides(deck.slides.length);
  }
  return { deck, session };
}

export function handleBasePresentationKey(e: KeyboardEvent, session: PresentationSession | null): boolean {
  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
    case 'Enter':
      e.preventDefault();
      session?.next();
      return true;
    case 'ArrowLeft':
    case 'PageUp':
    case 'Backspace':
      e.preventDefault();
      session?.prev();
      return true;
    case 'Home':
      e.preventDefault();
      session?.first();
      return true;
    case 'End':
      e.preventDefault();
      session?.last();
      return true;
    case 'b':
    case '.':
      e.preventDefault();
      session?.toggleBlackout();
      return true;
    case 'w':
      e.preventDefault();
      session?.toggleWhiteout();
      return true;
    default:
      return false;
  }
}

/**
 * Interactive iframes (presentation view) receive pointer events so links and
 * videos in the slide work, and get `allow-scripts` because nested embeds
 * (e.g. YouTube iframes) inherit the sandbox and need scripts to play.
 */
export function createSlideIframe(interactive = false): HTMLIFrameElement {
  const iframe = createBaseIframe();
  iframe.style.cssText =
    `width:${SLIDE_W}px;height:${SLIDE_H}px;border:0;display:block;background:transparent;` +
    (interactive ? '' : 'pointer-events:none;');
  return iframe;
}

export function createIconButton(
  parent: HTMLElement,
  cls: string,
  icon: string,
  title: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const btn = parent.createEl('button', { cls, attr: { title } });
  setIcon(btn, icon);
  btn.onclick = onClick;
  return btn;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatTime(sec: number): string {
  return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
}

export function formatClockTime(d = new Date()): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Check if an element is an editable input, textarea, contenteditable, or CodeMirror editor.
 */
export function isEditableElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (typeof el.closest === 'function') {
    if (el.closest('input, textarea, select, [contenteditable="true"], .cm-content, .cm-editor, .markdown-source-view')) {
      return true;
    }
  }
  return false;
}

/**
 * Determine if a presentation or presenter view tab/window is currently in focus.
 */
export function isViewInFocus(view: {
  app: any;
  leaf: any;
  containerEl: HTMLElement;
  contentEl?: HTMLElement;
  isPopout?: () => boolean;
}): boolean {
  const doc = view.containerEl?.ownerDocument || document;

  // 1. Check window focus
  if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) {
    return false;
  }

  // 2. If the active element in the document is editable, do not capture
  if (isEditableElement(doc.activeElement)) {
    return false;
  }

  // 3. If focus is directly on or inside this view's container, it is in focus
  if (
    view.containerEl &&
    (view.containerEl.contains(doc.activeElement) ||
      doc.activeElement === view.containerEl ||
      (view.contentEl && doc.activeElement === view.contentEl))
  ) {
    return true;
  }

  // 4. Popout window scenario
  const isPopout = typeof view.isPopout === 'function' ? view.isPopout() : doc !== document;
  if (isPopout) {
    if (view.containerEl && view.containerEl.offsetParent === null && !view.containerEl.classList?.contains('mod-active')) {
      return false;
    }
    const activeLeaf = (view.app?.workspace as any)?.activeLeaf ?? (view.app?.workspace as any)?.getActiveLeaf?.();
    if (activeLeaf && view.leaf && activeLeaf !== view.leaf) {
      return false;
    }
    return true;
  }

  // 5. Main window / tab scenario:
  const activeLeaf = (view.app?.workspace as any)?.activeLeaf ?? (view.app?.workspace as any)?.getActiveLeaf?.();
  if (activeLeaf && view.leaf) {
    return activeLeaf === view.leaf;
  }

  // Fallback: check mod-active CSS class on the leaf container
  const leafEl = view.containerEl?.closest?.('.workspace-leaf') || view.leaf?.containerEl;
  if (leafEl?.classList?.contains('mod-active')) {
    return true;
  }

  // If no activeLeaf or mod-active is found (e.g. minimal test environment), fallback to true
  if (!activeLeaf && !leafEl?.classList?.contains('mod-active')) {
    return true;
  }

  return false;
}
