// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkdownView, WorkspaceLeaf, TFile, Menu, Platform } from 'obsidian';
import { HeaderActionManager, isMarpFile } from '../src/presentation/headerAction';
import * as service from '../src/presentation/service';
import * as exportService from '../src/export/service';

function createMockApp() {
  const leaves: WorkspaceLeaf[] = [];
  return {
    vault: {
      getAbstractFileByPath: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn(),
    },
    workspace: {
      iterateAllLeaves: vi.fn((cb: (leaf: WorkspaceLeaf) => any) => {
        leaves.forEach(cb);
      }),
      _leaves: leaves,
    },
  };
}

function createMockPlugin(app: any) {
  return {
    app,
    settings: {
      showViewHeaderButton: true,
      autoOpenPresenterView: false,
    },
    engine: {},
    themes: {},
  };
}

describe('HeaderActionManager', () => {
  let app: any;
  let plugin: any;
  let manager: HeaderActionManager;

  beforeEach(() => {
    app = createMockApp();
    plugin = createMockPlugin(app);
    manager = new HeaderActionManager(app, plugin);
  });

  afterEach(() => {
    manager.destroy();
    vi.restoreAllMocks();
  });

  describe('isMarpFile', () => {
    it('returns true when frontmatter has marp: true', () => {
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });
      expect(isMarpFile(app, file)).toBe(true);
    });

    it('returns true when frontmatter has marp: "true"', () => {
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: 'true' } });
      expect(isMarpFile(app, file)).toBe(true);
    });

    it('returns false when frontmatter marp is false or missing', () => {
      const file = { extension: 'md', path: 'note.md' } as TFile;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: false } });
      expect(isMarpFile(app, file)).toBe(false);

      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });
      expect(isMarpFile(app, file)).toBe(false);

      app.metadataCache.getFileCache.mockReturnValue(null);
      expect(isMarpFile(app, file)).toBe(false);
    });

    it('returns false for non-markdown files', () => {
      const file = { extension: 'png', path: 'image.png' } as TFile;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });
      expect(isMarpFile(app, file)).toBe(false);
    });

    it('returns false for null or undefined file', () => {
      expect(isMarpFile(app, null)).toBe(false);
      expect(isMarpFile(app, undefined)).toBe(false);
    });
  });

  describe('updateView and button lifecycle', () => {
    it('creates presentation action button when file is Marp and showViewHeaderButton is true', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;

      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();
      expect(btn?.classList.contains('marp-view-action-presentation')).toBe(true);
      expect(btn?.getAttribute('aria-label')).toBe('Start Marp presentation');
      expect(btn?.getAttribute('data-icon')).toBe('presentation');
      expect(btn?.style.display).toBe('');
    });

    it('does not create button when file is not Marp', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'note.md' } as TFile;
      view.file = file;

      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} });

      const btn = manager.updateView(view);
      expect(btn).toBeNull();
    });

    it('hides existing button when file changes from Marp to non-Marp, and shows it when changes back', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const marpFile = { extension: 'md', path: 'deck.md' } as TFile;
      const nonMarpFile = { extension: 'md', path: 'note.md' } as TFile;

      // Start as Marp
      view.file = marpFile;
      app.metadataCache.getFileCache.mockImplementation((f: TFile) => ({
        frontmatter: { marp: f.path === 'deck.md' },
      }));

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();
      expect(btn?.style.display).toBe('');

      // Switch to non-Marp
      view.file = nonMarpFile;
      manager.updateView(view);
      expect(btn?.style.display).toBe('none');

      // Switch back to Marp
      view.file = marpFile;
      manager.updateView(view);
      expect(btn?.style.display).toBe('');
    });

    it('hides button when showViewHeaderButton setting is false', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();
      expect(btn?.style.display).toBe('');

      plugin.settings.showViewHeaderButton = false;
      manager.updateView(view);
      expect(btn?.style.display).toBe('none');
    });

    it('positions button before reading/editing switcher if present in view-actions', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      // Add dummy mode toggle button to view.headerActionsEl
      const modeToggle = document.createElement('div');
      modeToggle.className = 'clickable-icon view-action';
      modeToggle.setAttribute('aria-label', 'Current view: editing. Click to read');
      view.headerActionsEl.appendChild(modeToggle);

      // Add dummy more options button
      const moreOptions = document.createElement('div');
      moreOptions.className = 'clickable-icon view-action';
      moreOptions.setAttribute('aria-label', 'More options');
      view.headerActionsEl.appendChild(moreOptions);

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();

      // Check DOM ordering: btn should be before modeToggle
      expect(btn?.nextElementSibling).toBe(modeToggle);
    });

    it('calls startPresentation and saves view on click', async () => {
      const startPresSpy = vi.spyOn(service, 'startPresentation').mockResolvedValue({} as any);
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;
      view.save = vi.fn().mockResolvedValue(undefined);
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();

      // Click button
      btn?.dispatchEvent(new MouseEvent('click'));

      // Wait a tick for async callback
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(view.save).toHaveBeenCalled();
      expect(startPresSpy).toHaveBeenCalledWith(app, plugin, file);
    });

    it('shows context menu on right-click with presentation actions', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();

      const showSpy = vi.spyOn(Menu.prototype, 'showAtMouseEvent');
      const addItemSpy = vi.spyOn(Menu.prototype, 'addItem');

      const ctxEvt = new MouseEvent('contextmenu', { cancelable: true });
      btn?.dispatchEvent(ctxEvt);

      expect(showSpy).toHaveBeenCalledWith(ctxEvt);
      expect(addItemSpy).toHaveBeenCalled();
    });

    it('destroy removes all created action buttons from DOM', () => {
      const leaf = new WorkspaceLeaf(app);
      const view = new MarkdownView(leaf);
      const file = { extension: 'md', path: 'deck.md' } as TFile;
      view.file = file;
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: true } });

      const btn = manager.updateView(view);
      expect(btn).not.toBeNull();
      expect(view.headerActionsEl.contains(btn!)).toBe(true);

      manager.destroy();
      expect(view.headerActionsEl.contains(btn!)).toBe(false);
    });
  });

  describe('updateAll and updateForFile', () => {
    it('iterates all leaves and updates them', () => {
      const leaf1 = new WorkspaceLeaf(app);
      const view1 = new MarkdownView(leaf1);
      view1.file = { extension: 'md', path: 'deck.md' } as TFile;

      const leaf2 = new WorkspaceLeaf(app);
      const view2 = new MarkdownView(leaf2);
      view2.file = { extension: 'md', path: 'note.md' } as TFile;

      app.workspace._leaves.push(leaf1, leaf2);
      app.metadataCache.getFileCache.mockImplementation((f: TFile) => ({
        frontmatter: { marp: f.path === 'deck.md' },
      }));

      manager.updateAll();

      const btn1 = view1.headerActionsEl.querySelector('.marp-view-action-presentation') as HTMLElement;
      const btn2 = view2.headerActionsEl.querySelector('.marp-view-action-presentation') as HTMLElement;

      expect(btn1).not.toBeNull();
      expect(btn1.style.display).toBe('');
      expect(btn2).toBeNull();
    });

    it('updates only leaves viewing a specific file with updateForFile', () => {
      const leaf1 = new WorkspaceLeaf(app);
      const view1 = new MarkdownView(leaf1);
      const file1 = { extension: 'md', path: 'deck.md' } as TFile;
      view1.file = file1;

      const leaf2 = new WorkspaceLeaf(app);
      const view2 = new MarkdownView(leaf2);
      const file2 = { extension: 'md', path: 'other.md' } as TFile;
      view2.file = file2;

      app.workspace._leaves.push(leaf1, leaf2);
      app.metadataCache.getFileCache.mockImplementation((f: TFile) => ({
        frontmatter: { marp: f.path === 'deck.md' },
      }));

      // Initial update
      manager.updateAll();
      const btn1 = view1.headerActionsEl.querySelector('.marp-view-action-presentation') as HTMLElement;
      expect(btn1.style.display).toBe('');

      // Now change frontmatter of deck.md to false
      app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { marp: false } });
      manager.updateForFile(file1);
      expect(btn1.style.display).toBe('none');
    });
  });
});
