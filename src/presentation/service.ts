import { App, Platform, TFile, WorkspaceLeaf, WorkspaceWindowInitData } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import { MARP_PRESENTATION_VIEW_TYPE, MARP_PRESENTER_VIEW_TYPE } from './types';
import { MarpPresenterView } from './presenterView';
import { MarpPresentationView } from './presentationView';

export interface PresentationLaunchOptions {
  slideIndex?: number;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resolveWin(win?: Window): any {
  return win ?? (typeof window !== 'undefined' ? window : (globalThis as any));
}

/**
 * Retrieve Electron screen module if available in Desktop environment.
 */
export function getElectronScreenModule(win?: Window): any {
  if (!Platform.isDesktop) return null;

  const targetWin = resolveWin(win);
  try {
    const req = (targetWin as any)?.require ?? (window as any)?.require ?? (globalThis as any)?.require;
    if (typeof req === 'function') {
      const electron = req('electron');
      return electron?.screen ?? electron?.remote?.screen ?? null;
    }
  } catch {}
  return null;
}

/**
 * Detect if 2 or more screens are connected.
 * Supports Electron desktop environment and modern Window Management API (window.screen.isExtended).
 */
export function hasMultipleScreens(win?: Window): boolean {
  if (!Platform.isDesktop) return false;

  const targetWin = resolveWin(win);
  try {
    const displays = getElectronScreenModule(targetWin)?.getAllDisplays?.();
    if (Array.isArray(displays)) return displays.length >= 2;
  } catch (err) {
    console.debug('[marp-presentation] multi-screen detection failed:', err);
  }

  return !!(targetWin?.screen as any)?.isExtended;
}

/**
 * Listen for display connect/disconnect events across Electron and browser APIs.
 * Returns an unsubscribe cleanup function.
 */
export function observeScreenChanges(callback: () => void, win?: Window): () => void {
  const targetWin = resolveWin(win);
  const screenModule = getElectronScreenModule(targetWin);
  if (screenModule && typeof screenModule.on === 'function') {
    screenModule.on('display-added', callback);
    screenModule.on('display-removed', callback);
    return () => {
      screenModule.removeListener?.('display-added', callback);
      screenModule.removeListener?.('display-removed', callback);
    };
  }

  const screenObj = targetWin?.screen;
  if (screenObj && typeof screenObj.addEventListener === 'function') {
    screenObj.addEventListener('change', callback);
    return () => screenObj.removeEventListener?.('change', callback);
  }

  return () => {};
}

/**
 * Detect if multiple screens are available on desktop.
 * If 2 or more displays exist, returns the bounds of the other display
 * (not the display containing the current window).
 */
export function getOtherDisplayBounds(win?: Window): DisplayBounds | null {
  if (!Platform.isDesktop) return null;

  const targetWin = resolveWin(win);
  try {
    const screenModule = getElectronScreenModule(targetWin);
    const displays = screenModule?.getAllDisplays?.();
    if (!Array.isArray(displays) || displays.length <= 1) return null;

    const winX = targetWin.screenX ?? targetWin.screenLeft ?? 0;
    const winY = targetWin.screenY ?? targetWin.screenTop ?? 0;
    const currentDisplay = screenModule.getDisplayNearestPoint?.({ x: winX, y: winY });

    const other = displays.find((d: any) => d.id !== currentDisplay?.id) ?? displays[1];
    if (other?.bounds) {
      return {
        x: other.bounds.x,
        y: other.bounds.y,
        width: other.bounds.width,
        height: other.bounds.height,
      };
    }
  } catch (err) {
    console.debug('[marp-presentation] multi-screen detection failed:', err);
  }

  return null;
}

/**
 * Launch the Audience Presentation View (fullscreen slide show).
 * On desktop: launched in a fullscreen popout window (placed on the other screen if 2 screens detected).
 * On mobile: launched in a tab and requests fullscreen.
 */
export async function startPresentation(
  app: App,
  plugin: MarpInlinePreviewPlugin,
  file: TFile,
  options?: PresentationLaunchOptions,
): Promise<WorkspaceLeaf> {
  // Clean up any stale or lingering presentation leaves first
  const existingLeaves = app.workspace.getLeavesOfType?.(MARP_PRESENTATION_VIEW_TYPE) ?? [];
  for (const oldLeaf of existingLeaves) {
    try {
      const oldView = oldLeaf.view as MarpPresentationView;
      if (typeof oldView?.exitFullscreen === 'function') {
        void oldView.exitFullscreen();
      }
      oldLeaf.detach();
    } catch {}
  }

  const otherBounds = getOtherDisplayBounds();
  let leaf: WorkspaceLeaf;

  if (Platform.isDesktop) {
    const initData: WorkspaceWindowInitData = otherBounds ?? {
      x: window.screenX ?? 0,
      y: window.screenY ?? 0,
      size: {
        width: window.screen.width,
        height: window.screen.height,
      },
    };
    leaf = app.workspace.openPopoutLeaf(initData);
  } else {
    // Mobile fallback: open in tab
    leaf = app.workspace.getLeaf('tab');
  }

  await leaf.setViewState({
    type: MARP_PRESENTATION_VIEW_TYPE,
    active: true,
    state: {
      filePath: file.path,
      slideIndex: options?.slideIndex ?? 0,
    },
  });

  app.workspace.setActiveLeaf(leaf, { focus: true });

  const presView = leaf.view as MarpPresentationView;
  if (presView) {
    if (typeof presView.enterFullscreen === 'function') {
      void presView.enterFullscreen();
    }
    const doc = presView.containerEl?.ownerDocument;
    doc?.defaultView?.focus();
    presView.contentEl?.focus();
    setTimeout(() => {
      doc?.defaultView?.focus();
      presView.contentEl?.focus();
      if (typeof presView.enterFullscreen === 'function') {
        void presView.enterFullscreen();
      }
    }, 150);
  }

  // If user configured to automatically open presenter view in an Obsidian tab
  if (plugin.settings.autoOpenPresenterView) {
    void openPresenterView(app, plugin, file, {
      slideIndex: options?.slideIndex ?? 0,
    });
  }

  return leaf;
}

/**
 * Retrieve or create a tab leaf inside the main (original) Obsidian window,
 * avoiding any popout windows.
 */
export function getMainWindowTabLeaf(app: App): WorkspaceLeaf {
  const root = app.workspace.rootSplit;
  if (root) {
    const mainLeaf = app.workspace.getMostRecentLeaf?.(root);
    if (mainLeaf) {
      if (mainLeaf.parent && typeof app.workspace.createLeafInParent === 'function') {
        return app.workspace.createLeafInParent(mainLeaf.parent, -1);
      }
      app.workspace.setActiveLeaf(mainLeaf);
    } else if (typeof app.workspace.createLeafInParent === 'function') {
      return app.workspace.createLeafInParent(root, -1);
    }
  }
  return app.workspace.getLeaf('tab');
}

/**
 * Launch the Presenter View (companion dashboard with notes, timer, next slide).
 * Opens inside a new tab in the original Obsidian window.
 */
export async function openPresenterView(
  app: App,
  plugin: MarpInlinePreviewPlugin,
  file: TFile,
  options?: PresentationLaunchOptions,
): Promise<WorkspaceLeaf> {
  // Check if an existing presenter view for this file is already open
  let existingLeaf: WorkspaceLeaf | null = null;
  app.workspace.iterateAllLeaves((l) => {
    if (existingLeaf) return;
    if (l.view.getViewType() === MARP_PRESENTER_VIEW_TYPE) {
      const pv = l.view as MarpPresenterView;
      if (pv.file?.path === file.path) {
        existingLeaf = l;
      }
    }
  });

  if (existingLeaf) {
    app.workspace.setActiveLeaf(existingLeaf, { focus: true });
    return existingLeaf;
  }

  // Open as a tab in the original Obsidian window
  const leaf = getMainWindowTabLeaf(app);

  await leaf.setViewState({
    type: MARP_PRESENTER_VIEW_TYPE,
    active: true,
    state: {
      filePath: file.path,
      slideIndex: options?.slideIndex ?? 0,
    },
  });

  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}
