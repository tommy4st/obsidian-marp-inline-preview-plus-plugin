// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarpPresentationView } from '../src/presentation/presentationView';
import { MarpPresenterView } from '../src/presentation/presenterView';
import {
  MARP_PRESENTATION_VIEW_TYPE,
  MARP_PRESENTER_VIEW_TYPE,
  formatTime,
  formatClockTime,
  isEditableElement,
  isViewInFocus,
} from '../src/presentation/types';
import {
  openPresenterView,
  startPresentation,
  getOtherDisplayBounds,
  hasMultipleScreens,
} from '../src/presentation/service';
import { PresentationSession } from '../src/presentation/session';

describe('MarpPresentationView and MarpPresenterView', () => {
  let app: any;
  let mockPlugin: any;
  let mockFile: any;

  const createMockLeaf = (appInstance: any) => ({
    app: appInstance,
    containerEl: document.createElement('div'),
    setViewState: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(),
    view: null,
  });

  beforeEach(() => {
    PresentationSession.get('test.md')?.destroy();

    app = {
      vault: {
        cachedRead: vi.fn().mockResolvedValue('# Slide 1\n<!-- Speaker note for slide 1 -->\n---\n# Slide 2'),
        getAbstractFileByPath: vi.fn(),
        on: vi.fn().mockReturnValue({ id: 'ref' }),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: {
            marp: true,
            theme: 'default',
          },
        }),
      },
      workspace: {
        iterateAllLeaves: vi.fn(),
        setActiveLeaf: vi.fn(),
        openPopoutLeaf: vi.fn(),
        getLeaf: vi.fn(),
      },
    };

    mockPlugin = {
      app,
      settings: {},
      themes: {
        collect: vi.fn().mockResolvedValue({
          name: 'default',
          css: '/* default theme */',
          type: 'builtin',
        }),
      },
      engine: {
        renderArray: vi.fn().mockReturnValue({
          html: ['<section><h1>Slide 1</h1></section>', '<section><h1>Slide 2</h1></section>'],
          css: '/* marp css */',
          comments: [['Speaker note for slide 1'], []],
        }),
      },
    };

    mockFile = {
      path: 'test.md',
      basename: 'test',
    };
  });

  afterEach(() => {
    PresentationSession.get('test.md')?.destroy();
    vi.restoreAllMocks();
  });

  describe('Focus and Editable Helpers', () => {
    it('isEditableElement returns true for inputs, textareas, selects, and contenteditable elements', () => {
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const select = document.createElement('select');
      const div = document.createElement('div');
      const contentEditableDiv = document.createElement('div');
      contentEditableDiv.contentEditable = 'true';
      const cmEditor = document.createElement('div');
      cmEditor.className = 'cm-editor';
      const cmContent = document.createElement('div');
      cmContent.className = 'cm-content';
      cmEditor.appendChild(cmContent);

      expect(isEditableElement(input)).toBe(true);
      expect(isEditableElement(textarea)).toBe(true);
      expect(isEditableElement(select)).toBe(true);
      expect(isEditableElement(contentEditableDiv)).toBe(true);
      expect(isEditableElement(cmContent)).toBe(true);
      expect(isEditableElement(div)).toBe(false);
      expect(isEditableElement(null)).toBe(false);
    });

    it('isViewInFocus correctly respects activeLeaf, editor focus, and document focus', () => {
      const presLeaf = createMockLeaf(app);
      const editorLeaf = createMockLeaf(app);

      const view = new MarpPresentationView(presLeaf as any, mockPlugin as any);
      document.body.appendChild(view.containerEl);

      // 1. When doc.hasFocus is false
      const origHasFocus = document.hasFocus;
      document.hasFocus = () => false;
      expect(isViewInFocus(view as any)).toBe(false);
      document.hasFocus = origHasFocus || (() => true);

      // 2. When activeLeaf is the editor tab
      app.workspace.activeLeaf = editorLeaf;
      expect(isViewInFocus(view as any)).toBe(false);

      // 3. When activeLeaf is the presentation tab
      app.workspace.activeLeaf = presLeaf;
      expect(isViewInFocus(view as any)).toBe(true);

      // 4. When activeElement is an editable input inside the doc
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      expect(isViewInFocus(view as any)).toBe(false);

      input.remove();
      view.containerEl.remove();
    });
  });

  describe('MarpPresentationView', () => {
    it('mounts stage, overlay, and HUD on open', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);

      await view.onOpen();

      expect(view.contentEl.classList.contains('marp-presentation-view')).toBe(true);
      const stage = view.contentEl.querySelector('.marp-presentation-stage');
      expect(stage).not.toBeNull();
      const iframe = view.contentEl.querySelector('iframe');
      expect(iframe).not.toBeNull();
      const overlay = view.contentEl.querySelector('.marp-presentation-blank-overlay');
      expect(overlay).not.toBeNull();
      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      expect(hud).not.toBeNull();

      await view.onClose();
    });

    it('loads file, creates session, and responds to keyboard navigation', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      expect(view.session).toBeDefined();
      expect(view.session?.currentSlide).toBe(0);
      expect(view.session?.totalSlides).toBe(2);

      const counter = view.contentEl.querySelector('.marp-presentation-hud-counter');
      expect(counter?.textContent).toBe('Slide 1 / 2');

      // Dispatch ArrowRight keydown
      view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(view.session?.currentSlide).toBe(1);
      expect(counter?.textContent).toBe('Slide 2 / 2');

      // Dispatch 'b' keydown for blackout
      view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
      expect(view.session?.isBlackout).toBe(true);
      const overlay = view.contentEl.querySelector('.marp-presentation-blank-overlay');
      expect(overlay?.classList.contains('is-blackout')).toBe(true);

      // HUD visibility on mouse movement
      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      view.contentEl.dispatchEvent(new MouseEvent('mousemove'));
      expect(hud?.classList.contains('is-visible')).toBe(true);

      // Clean up
      await view.onClose();
    });

    it('ignores keystrokes when editing tab is in focus or focus is in an editor element', async () => {
      const presLeaf = createMockLeaf(app);
      const editorLeaf = createMockLeaf(app);

      const view = new MarpPresentationView(presLeaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      document.body.appendChild(view.containerEl);

      expect(view.session?.currentSlide).toBe(0);

      // Set activeLeaf to editor tab
      app.workspace.activeLeaf = editorLeaf;

      // Dispatching ArrowRight should NOT navigate because editor tab is active
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(view.session?.currentSlide).toBe(0);

      // Switch activeLeaf to presentation tab
      app.workspace.activeLeaf = presLeaf;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(view.session?.currentSlide).toBe(1);

      // When activeElement is an editor (.cm-content) inside the document
      const cmEditor = document.createElement('div');
      cmEditor.className = 'cm-editor';
      const cmContent = document.createElement('div');
      cmContent.className = 'cm-content';
      cmContent.tabIndex = 0;
      cmEditor.appendChild(cmContent);
      document.body.appendChild(cmEditor);
      cmContent.focus();

      // Dispatch ArrowLeft from editor
      cmContent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      // Slide should NOT change
      expect(view.session?.currentSlide).toBe(1);

      // Shortcuts with modifier keys (Ctrl+P, Ctrl+F, Cmd+W) are ignored
      view.contentEl.focus();
      const ctrlP = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true });
      const ctrlPSpy = vi.spyOn(ctrlP, 'preventDefault');
      document.dispatchEvent(ctrlP);
      expect(ctrlPSpy).not.toHaveBeenCalled();

      cmEditor.remove();
      view.containerEl.remove();
      await view.onClose();
    });

    it('hides mouse cursor when HUD toolbar hides after timeout, and restores on movement', async () => {
      vi.useFakeTimers();
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      expect(hud?.classList.contains('is-visible')).toBe(true);

      // Fast-forward past HUD timeout
      vi.advanceTimersByTime(2600);

      // HUD should hide and cursor should have is-cursor-hidden class
      expect(hud?.classList.contains('is-visible')).toBe(false);
      expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(true);

      // Moving mouse restores visibility
      view.contentEl.dispatchEvent(new MouseEvent('mousemove'));
      expect(hud?.classList.contains('is-visible')).toBe(true);
      expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(false);

      // Leaving window/container hides cursor and HUD immediately
      view.contentEl.dispatchEvent(new PointerEvent('pointerleave'));
      expect(hud?.classList.contains('is-visible')).toBe(false);
      expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(true);

      await view.onClose();
      vi.useRealTimers();
    });

    it('responds to keyboard events dispatched to document without prior element click', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);
      document.body.appendChild(view.containerEl);

      expect(view.session?.currentSlide).toBe(0);

      // Dispatch directly on document window
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(view.session?.currentSlide).toBe(1);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(view.session?.currentSlide).toBe(0);

      view.containerEl.remove();
      await view.onClose();
    });

    it('supports mobile touch interactions: wakes HUD on touch and navigates on horizontal swipe', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      expect(view.session?.currentSlide).toBe(0);

      // Touch start wakes HUD
      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      hud?.classList.remove('is-visible');

      const touchStart = new TouchEvent('touchstart', {
        touches: [{ clientX: 300, clientY: 200 } as any],
      });
      view.contentEl.dispatchEvent(touchStart);
      expect(hud?.classList.contains('is-visible')).toBe(true);

      // Horizontal swipe left (next slide)
      const touchEndLeft = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 210 } as any],
      });
      view.contentEl.dispatchEvent(touchEndLeft);
      expect(view.session?.currentSlide).toBe(1);

      // Horizontal swipe right (previous slide)
      const touchStart2 = new TouchEvent('touchstart', {
        touches: [{ clientX: 100, clientY: 200 } as any],
      });
      view.contentEl.dispatchEvent(touchStart2);
      const touchEndRight = new TouchEvent('touchend', {
        changedTouches: [{ clientX: 300, clientY: 205 } as any],
      });
      view.contentEl.dispatchEvent(touchEndRight);
      expect(view.session?.currentSlide).toBe(0);

      await view.onClose();
    });

    it('manages mobile status bar and fullscreen request with navigationUI hide', async () => {
      const mockStatusBar = {
        hide: vi.fn().mockResolvedValue(undefined),
        setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
        show: vi.fn().mockResolvedValue(undefined),
      };
      (window as any).Capacitor = {
        Plugins: { StatusBar: mockStatusBar },
      };

      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);

      const requestFsSpy = vi.fn().mockResolvedValue(undefined);
      (view.containerEl as any).requestFullscreen = requestFsSpy;

      await view.onOpen();
      await view.enterFullscreen();

      expect(mockStatusBar.hide).toHaveBeenCalled();
      expect(mockStatusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: true });
      expect(requestFsSpy).toHaveBeenCalledWith({ navigationUI: 'hide' });

      await view.exitFullscreen();
      await view.onClose();
      expect(mockStatusBar.show).toHaveBeenCalled();
      expect(mockStatusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });

      delete (window as any).Capacitor;
    });

    it('only shows presenter view button in HUD when 2 or more screens are connected', async () => {
      // Single screen
      const originalRequire = (window as any).require;
      (window as any).require = vi.fn().mockReturnValue({
        screen: {
          getAllDisplays: vi.fn().mockReturnValue([{ id: 1 }]),
        },
      });

      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();

      const presenterBtn = (view as any).presenterBtn as HTMLElement;
      expect(presenterBtn?.style.display).toBe('none');

      // Multi-screen
      (window as any).require = vi.fn().mockReturnValue({
        screen: {
          getAllDisplays: vi.fn().mockReturnValue([{ id: 1 }, { id: 2 }]),
        },
      });

      view.updatePresenterButtonVisibility();
      expect(presenterBtn?.style.display).toBe('');

      (window as any).require = originalRequire;
      await view.onClose();
    });

    it('does not render a fullscreen toggle button in the HUD toolbar', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();

      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      const fullscreenBtn = hud?.querySelector('button[title*="Fullscreen"]');
      expect(fullscreenBtn).toBeNull();

      await view.onClose();
    });

    it('pressing Escape key exits presentation view and detaches the leaf', async () => {
      const origHasFocus = document.hasFocus;
      document.hasFocus = () => true;
      const leaf = createMockLeaf(app);
      app.workspace.activeLeaf = leaf;
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);
      document.body.appendChild(view.containerEl);

      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escEvent);
      await new Promise((r) => setTimeout(r, 10));

      expect(leaf.detach).toHaveBeenCalled();

      view.containerEl.remove();
      await view.onClose();
      document.hasFocus = origHasFocus;
    });

    it('exiting fullscreen triggers presentation view exit', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      // Simulate entering fullscreen first
      Object.defineProperty(document, 'fullscreenElement', {
        value: view.containerEl,
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));

      // Simulate exiting fullscreen (e.g. via browser Esc key or OS)
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        configurable: true,
        writable: true,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
      await new Promise((r) => setTimeout(r, 10));

      expect(leaf.detach).toHaveBeenCalled();

      await view.onClose();
    });
  });

  describe('MarpPresenterView', () => {
    it('initializes with correct view type, displays previews, and shows speaker notes', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresenterView(leaf as any, mockPlugin as any);

      expect(view.getViewType()).toBe(MARP_PRESENTER_VIEW_TYPE);

      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      expect(view.session).toBeDefined();
      expect(view.session?.currentSlide).toBe(0);

      // Check current and next slide iframes
      const iframes = view.contentEl.querySelectorAll('iframe');
      expect(iframes.length).toBe(2);

      const wrappers = view.contentEl.querySelectorAll('.marp-presenter-slide-wrapper');
      expect(wrappers.length).toBe(2);

      // Check speaker notes container
      const notesContent = view.contentEl.querySelector('.marp-presenter-notes-content');
      expect(notesContent).not.toBeNull();
      expect(notesContent?.textContent).toContain('Speaker note for slide 1');

      // Check header timer display
      const timerDisplay = view.contentEl.querySelector('.marp-presenter-timer-text');
      expect(timerDisplay?.textContent).toBe('00:00:00');

      // Check slide selector
      const select = view.contentEl.querySelector('select.marp-presenter-select') as HTMLSelectElement;
      expect(select).not.toBeNull();
      expect(select.options.length).toBe(2);

      // Clean up
      await view.onClose();
    });
  });

  describe('Presentation Launch Service', () => {
    it('openPresenterView opens inside an Obsidian tab', async () => {
      const mockLeaf = createMockLeaf(app);
      app.workspace.getLeaf.mockReturnValue(mockLeaf);

      const leaf = await openPresenterView(app, mockPlugin, mockFile as any);
      expect(app.workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(mockLeaf.setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MARP_PRESENTER_VIEW_TYPE,
          active: true,
        }),
      );
      expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(mockLeaf, { focus: true });
    });

    it('openPresenterView creates a tab in the main window via rootSplit when active leaf is in popout', async () => {
      const mockMainLeaf = createMockLeaf(app);
      const mockParentTabs = {};
      (mockMainLeaf as any).parent = mockParentTabs;
      const createdLeaf = createMockLeaf(app);

      app.workspace.rootSplit = { containerEl: document.createElement('div') };
      app.workspace.getMostRecentLeaf = vi.fn().mockReturnValue(mockMainLeaf);
      app.workspace.createLeafInParent = vi.fn().mockReturnValue(createdLeaf);

      const leaf = await openPresenterView(app, mockPlugin, mockFile as any);
      expect(app.workspace.createLeafInParent).toHaveBeenCalledWith(mockParentTabs, -1);
      expect(leaf).toBe(createdLeaf);
      expect(createdLeaf.setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MARP_PRESENTER_VIEW_TYPE,
          active: true,
        }),
      );
      expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(createdLeaf, { focus: true });
    });

    it('startPresentation opens in popout window on desktop and requests fullscreen', async () => {
      const mockLeaf = createMockLeaf(app);
      const mockPresView = { enterFullscreen: vi.fn() };
      mockLeaf.view = mockPresView;
      app.workspace.openPopoutLeaf.mockReturnValue(mockLeaf);

      const leaf = await startPresentation(app, mockPlugin, mockFile as any);
      expect(app.workspace.openPopoutLeaf).toHaveBeenCalled();
      expect(mockLeaf.setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MARP_PRESENTATION_VIEW_TYPE,
          active: true,
        }),
      );
      expect(mockPresView.enterFullscreen).toHaveBeenCalled();
    });

    it('getOtherDisplayBounds returns bounds when multiple screens exist', () => {
      // Mock window.require with electron screen
      const originalRequire = (window as any).require;
      (window as any).require = vi.fn().mockReturnValue({
        screen: {
          getAllDisplays: vi.fn().mockReturnValue([
            { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
            { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
          ]),
          getDisplayNearestPoint: vi.fn().mockReturnValue({ id: 1 }),
        },
      });

      const bounds = getOtherDisplayBounds();
      expect(bounds).toEqual({ x: 1920, y: 0, width: 2560, height: 1440 });

      (window as any).require = originalRequire;
    });

    it('getOtherDisplayBounds returns null when only one screen exists', () => {
      const originalRequire = (window as any).require;
      (window as any).require = vi.fn().mockReturnValue({
        screen: {
          getAllDisplays: vi.fn().mockReturnValue([
            { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
          ]),
          getDisplayNearestPoint: vi.fn().mockReturnValue({ id: 1 }),
        },
      });

      const bounds = getOtherDisplayBounds();
      expect(bounds).toBeNull();

      (window as any).require = originalRequire;
    });

    it('hasMultipleScreens detects multi-display configurations', () => {
      expect(hasMultipleScreens()).toBe(false);

      const originalRequire = (window as any).require;
      (window as any).require = vi.fn().mockReturnValue({
        screen: {
          getAllDisplays: vi.fn().mockReturnValue([{ id: 1 }, { id: 2 }]),
        },
      });

      expect(hasMultipleScreens()).toBe(true);

      (window as any).require = originalRequire;
    });
  });
});
