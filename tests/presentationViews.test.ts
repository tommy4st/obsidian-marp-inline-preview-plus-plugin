// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Platform } from 'obsidian';
import { MarpPresentationView } from '../src/presentation/presentationView';
import { MarpPresenterView } from '../src/presentation/presenterView';
import { MARP_PRESENTATION_VIEW_TYPE, MARP_PRESENTER_VIEW_TYPE } from '../src/presentation/types';
import { PresentationSession } from '../src/presentation/session';
import {
  startPresentation,
  openPresenterView,
  getOtherDisplayBounds,
  hasMultipleScreens,
} from '../src/presentation/service';

function createMockLeaf(app: any) {
  return {
    app,
    view: null as any,
    detach: vi.fn(),
    setViewState: vi.fn(),
    getViewState: vi.fn(),
  };
}

function createMockPlugin(app: any) {
  return {
    app,
    settings: {
      autoOpenPresenterView: false,
    },
    themes: {
      collect: vi.fn().mockResolvedValue('default'),
    },
    engine: {
      renderArray: vi.fn().mockReturnValue({
        html: ['<section><h1>Slide 1</h1></section>', '<section><h1>Slide 2</h1></section>'],
        css: '/* marp css */',
        comments: [['Speaker note for slide 1'], ['Speaker note for slide 2']],
      }),
    },
  };
}

describe('MarpPresentationView and MarpPresenterView', () => {
  let app: any;
  let mockPlugin: any;
  const mockFile = {
    path: 'slides/presentation-test.md',
    basename: 'presentation-test',
    extension: 'md',
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    app = {
      vault: {
        cachedRead: vi.fn().mockResolvedValue('---\nmarp: true\n---\n# Slide 1\n<!-- note 1 -->\n---\n# Slide 2'),
        getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
        on: vi.fn().mockReturnValue({ id: 'evt-1' }),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { marp: true },
        }),
      },
      workspace: {
        iterateAllLeaves: vi.fn(),
        setActiveLeaf: vi.fn(),
        openPopoutLeaf: vi.fn(),
        getLeaf: vi.fn(),
      },
    };
    mockPlugin = createMockPlugin(app);
  });

  afterEach(() => {
    PresentationSession.get(mockFile.path)?.destroy();
    vi.restoreAllMocks();
  });

  describe('MarpPresentationView', () => {
    it('initializes with correct view type and displayText', () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      expect(view.getViewType()).toBe(MARP_PRESENTATION_VIEW_TYPE);
      expect(view.getIcon()).toBe('presentation');
    });

    it('mounts stage, overlay, and HUD on open', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();

      const stage = view.contentEl.querySelector('.marp-presentation-stage');
      const overlay = view.contentEl.querySelector('.marp-presentation-blank-overlay');
      const hud = view.contentEl.querySelector('.marp-presentation-hud');

      expect(stage).not.toBeNull();
      expect(overlay).not.toBeNull();
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

      // Test laser canvas exists
      const laserCanvas = view.contentEl.querySelector('canvas.marp-laser-canvas');
      expect(laserCanvas).not.toBeNull();

      // Test laser pointer toggle via 'l' key
      expect(view.isLaserActive).toBe(false);
      view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
      expect(view.isLaserActive).toBe(true);
      expect(view.contentEl.classList.contains('is-laser-active')).toBe(true);

      // Dragging with laser pointer creates trails, hides HUD, and blocks sidebar swipe
      const hud = view.contentEl.querySelector('.marp-presentation-hud');
      const pDown = new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 });
      const pMove = new PointerEvent('pointermove', { clientX: 120, clientY: 120 });
      const pUp = new PointerEvent('pointerup', { clientX: 120, clientY: 120 });
      const tMove = new TouchEvent('touchmove', { cancelable: true });
      const pDownSpy = vi.spyOn(pDown, 'preventDefault');
      const pMoveSpy = vi.spyOn(pMove, 'preventDefault');
      const tMoveSpy = vi.spyOn(tMove, 'preventDefault');

      view.contentEl.dispatchEvent(pDown);
      expect(pDownSpy).toHaveBeenCalled();

      view.contentEl.dispatchEvent(pMove);
      expect(pMoveSpy).toHaveBeenCalled();
      expect(hud?.classList.contains('is-visible')).toBe(false);

      view.contentEl.dispatchEvent(tMove);
      expect(tMoveSpy).toHaveBeenCalled();

      view.contentEl.dispatchEvent(pUp);
      expect(hud?.classList.contains('is-visible')).toBe(false);

      // Moving mouse while laser is active does NOT wake HUD
      view.contentEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
      expect(hud?.classList.contains('is-visible')).toBe(false);
      view.contentEl.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));
      expect(hud?.classList.contains('is-visible')).toBe(false);

      // Just clicking with laser pointer (no drag) reveals HUD toolbar
      const pClickDown = new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 });
      const pClickUp = new PointerEvent('pointerup', { clientX: 100, clientY: 100, button: 0 });
      view.contentEl.dispatchEvent(pClickDown);
      view.contentEl.dispatchEvent(pClickUp);
      expect(hud?.classList.contains('is-visible')).toBe(true);

      // Hide HUD again to test touch tapping
      hud?.classList.remove('is-visible');
      expect(hud?.classList.contains('is-visible')).toBe(false);

      // Tapping with touch (pointerdown + small jitter move + pointerup + pointerleave) reveals HUD
      const tDown = new PointerEvent('pointerdown', { clientX: 150, clientY: 150, pointerType: 'touch' });
      const tJitter = new PointerEvent('pointermove', { clientX: 158, clientY: 156, pointerType: 'touch' }); // 10px jitter
      const tUp = new PointerEvent('pointerup', { clientX: 158, clientY: 156, pointerType: 'touch' });
      const tLeave = new PointerEvent('pointerleave', { pointerType: 'touch' }); // fires on touch liftoff
      view.contentEl.dispatchEvent(tDown);
      view.contentEl.dispatchEvent(tJitter);
      view.contentEl.dispatchEvent(tUp);
      expect(hud?.classList.contains('is-visible')).toBe(true);
      view.contentEl.dispatchEvent(tLeave);
      expect(hud?.classList.contains('is-visible')).toBe(true); // NOT hidden by touch pointerleave!

      // Clicking while laser pointer is active should NOT advance slide
      view.contentEl.dispatchEvent(new MouseEvent('click', { clientX: 800, clientY: 400 }));
      expect(view.session?.currentSlide).toBe(1); // remains on slide 1

      // Escape key turns off laser pointer first
      view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(view.isLaserActive).toBe(false);
      expect(view.contentEl.classList.contains('is-laser-active')).toBe(false);

      // Clean up
      await view.onClose();
    });

    it('hides mouse cursor when HUD toolbar hides after timeout, and restores on movement', async () => {
      vi.useFakeTimers();
      try {
        const leaf = createMockLeaf(app);
        const view = new MarpPresentationView(leaf as any, mockPlugin as any);
        await view.onOpen();

        const hud = view.contentEl.querySelector('.marp-presentation-hud');
        expect(hud?.classList.contains('is-visible')).toBe(true);
        expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(false);

        // Advance past the 2500ms auto-hide delay
        vi.advanceTimersByTime(2600);
        expect(hud?.classList.contains('is-visible')).toBe(false);
        expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(true);

        // Moving mouse restores visibility
        view.contentEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
        expect(hud?.classList.contains('is-visible')).toBe(true);
        expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(false);

        // Leaving the window immediately hides HUD and cursor
        view.contentEl.dispatchEvent(new PointerEvent('pointerleave'));
        expect(hud?.classList.contains('is-visible')).toBe(false);
        expect(view.contentEl.classList.contains('is-cursor-hidden')).toBe(true);

        await view.onClose();
      } finally {
        vi.useRealTimers();
      }
    });

    it('responds to keyboard events dispatched to document without prior element click', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();
      await view.loadFile(mockFile as any, 0);

      expect(view.session?.currentSlide).toBe(0);

      // Key event fired directly on document without clicking contentEl
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(view.session?.currentSlide).toBe(1);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(view.session?.currentSlide).toBe(0);

      await view.onClose();
    });

    it('supports mobile touch interactions: wakes HUD on touch and navigates on horizontal swipe', async () => {
      vi.useFakeTimers();
      try {
        const leaf = createMockLeaf(app);
        const view = new MarpPresentationView(leaf as any, mockPlugin as any);
        await view.onOpen();
        await view.loadFile(mockFile as any, 0);

        const hud = view.contentEl.querySelector('.marp-presentation-hud');
        expect(hud?.classList.contains('is-visible')).toBe(true);

        // Advance timers to hide HUD
        vi.advanceTimersByTime(2600);
        expect(hud?.classList.contains('is-visible')).toBe(false);

        // Touchstart on contentEl wakes the HUD
        view.contentEl.dispatchEvent(new TouchEvent('touchstart', {
          touches: [{ clientX: 200, clientY: 200 } as any],
        }));
        expect(hud?.classList.contains('is-visible')).toBe(true);

        // Horizontal swipe left (dx = -80) advances to next slide
        expect(view.session?.currentSlide).toBe(0);
        view.contentEl.dispatchEvent(new TouchEvent('touchend', {
          changedTouches: [{ clientX: 120, clientY: 205 } as any],
        }));
        expect(view.session?.currentSlide).toBe(1);

        // Subsequent synthetic click within 350ms is debounced
        view.contentEl.dispatchEvent(new MouseEvent('click', { clientX: 800, clientY: 400 }));
        expect(view.session?.currentSlide).toBe(1);

        // Horizontal swipe right (dx = +80) retreats to previous slide
        view.contentEl.dispatchEvent(new TouchEvent('touchstart', {
          touches: [{ clientX: 100, clientY: 200 } as any],
        }));
        view.contentEl.dispatchEvent(new TouchEvent('touchend', {
          changedTouches: [{ clientX: 180, clientY: 205 } as any],
        }));
        expect(view.session?.currentSlide).toBe(0);

        await view.onClose();
      } finally {
        vi.useRealTimers();
      }
    });

    it('manages mobile status bar and fullscreen request with navigationUI hide', async () => {
      const origDesktop = Platform.isDesktop;
      const origMobile = Platform.isMobile;
      (Platform as any).isDesktop = false;
      (Platform as any).isMobile = true;

      try {
        const leaf = createMockLeaf(app);
        const view = new MarpPresentationView(leaf as any, mockPlugin as any);
        await view.onOpen();

        const mockStatusBar = {
          hide: vi.fn().mockResolvedValue(undefined),
          show: vi.fn().mockResolvedValue(undefined),
          setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
        };
        (window as any).Capacitor = {
          Plugins: {
            StatusBar: mockStatusBar,
          },
        };

        const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined);
        const mockExitFullscreen = vi.fn().mockResolvedValue(undefined);
        document.documentElement.requestFullscreen = mockRequestFullscreen;
        document.exitFullscreen = mockExitFullscreen;
        (document as any).fullscreenElement = null;

        await view.enterFullscreen();
        expect(mockStatusBar.hide).toHaveBeenCalled();
        expect(mockStatusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: true });
        expect(mockRequestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });

        (document as any).fullscreenElement = document.documentElement;
        await view.exitFullscreen();
        expect(mockStatusBar.show).toHaveBeenCalled();
        expect(mockStatusBar.setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
        expect(mockExitFullscreen).toHaveBeenCalled();

        delete (window as any).Capacitor;
        await view.onClose();
      } finally {
        (Platform as any).isDesktop = origDesktop;
        (Platform as any).isMobile = origMobile;
      }
    });

    it('only shows presenter view button in HUD when 2 or more screens are connected', async () => {
      const leaf = createMockLeaf(app);
      const view = new MarpPresentationView(leaf as any, mockPlugin as any);
      await view.onOpen();

      const presenterBtn = view.contentEl.querySelector('button[title*="Presenter View"]') as HTMLElement;
      expect(presenterBtn?.style.display).toBe('none');

      const originalRequire = (window as any).require;
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

