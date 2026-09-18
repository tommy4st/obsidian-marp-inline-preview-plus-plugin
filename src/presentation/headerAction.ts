import { App, MarkdownView, Menu, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import { startPresentation, openPresenterView, hasMultipleScreens } from './service';
import { openPdfExportModal } from '../export/service';

export function isMarpFile(app: App, file: TFile | null | undefined): boolean {
  if (!file || file.extension !== 'md') return false;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return fm?.marp === true || fm?.marp === 'true';
}

export class HeaderActionManager {
  private actionButtons = new WeakMap<MarkdownView, HTMLElement>();
  private createdButtons = new Set<HTMLElement>();

  constructor(
    private app: App,
    private plugin: MarpInlinePreviewPlugin,
  ) {}

  /**
   * Update or create the presentation action button for a MarkdownView.
   */
  updateView(view: MarkdownView): HTMLElement | null {
    if (typeof view.addAction !== 'function') return null;

    const file = view.file;
    const isMarp = isMarpFile(this.app, file);
    const shouldShow = isMarp && this.plugin.settings.showViewHeaderButton;

    let actionEl = this.actionButtons.get(view);
    const isAttached = actionEl && (actionEl.isConnected || Boolean(view.containerEl?.contains(actionEl)));

    if (actionEl && isAttached) {
      actionEl.style.display = shouldShow ? '' : 'none';
      if (shouldShow) {
        this.positionActionNextToModeToggle(view, actionEl);
      }
      return actionEl;
    }

    // Only create button if it should be shown
    if (!shouldShow) return null;

    actionEl = view.addAction('presentation', 'Start Marp presentation', async () => {
      const activeFile = view.file;
      if (!activeFile || !isMarpFile(this.app, activeFile)) return;

      if (typeof view.save === 'function') {
        try {
          await view.save();
        } catch {}
      }
      void startPresentation(this.app, this.plugin, activeFile);
    });

    if (!actionEl) return null;

    actionEl.addClass('marp-view-action-presentation');
    this.actionButtons.set(view, actionEl);
    this.createdButtons.add(actionEl);

    // Right-click context menu with presentation actions
    actionEl.addEventListener('contextmenu', (evt: MouseEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      const activeFile = view.file;
      if (!activeFile || !isMarpFile(this.app, activeFile)) return;

      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle('Start Marp presentation')
          .setIcon('presentation')
          .onClick(async () => {
            if (typeof view.save === 'function') {
              try {
                await view.save();
              } catch {}
            }
            void startPresentation(this.app, this.plugin, activeFile);
          });
      });

      if (hasMultipleScreens()) {
        menu.addItem((item) => {
          item
            .setTitle('Open Marp presenter view')
            .setIcon('presentation')
            .onClick(() => {
              void openPresenterView(this.app, this.plugin, activeFile);
            });
        });
      }

      if (Platform.isDesktop) {
        menu.addItem((item) => {
          item
            .setTitle('Export Marp to PDF...')
            .setIcon('file-text')
            .onClick(() => {
              openPdfExportModal(activeFile, {
                plugin: this.plugin,
                engine: this.plugin.engine,
                themes: this.plugin.themes,
              });
            });
        });
      }

      menu.showAtMouseEvent(evt);
    });

    this.positionActionNextToModeToggle(view, actionEl);
    return actionEl;
  }

  /**
   * Position the presentation button immediately before the reading/editing switcher
   * if found in the view-actions container.
   */
  private positionActionNextToModeToggle(view: MarkdownView, actionEl: HTMLElement): void {
    try {
      const modeSwitchBtn = view.containerEl?.querySelector(
        '.view-actions [aria-label*="reading" i], .view-actions [aria-label*="editing" i], .view-actions [data-icon="book-open"], .view-actions [data-icon="pencil"], .view-actions svg.lucide-book-open, .view-actions svg.lucide-pencil',
      )?.closest('.view-action') as HTMLElement | null;

      if (modeSwitchBtn && modeSwitchBtn.parentElement && modeSwitchBtn !== actionEl) {
        if (actionEl.nextElementSibling !== modeSwitchBtn) {
          modeSwitchBtn.parentElement.insertBefore(actionEl, modeSwitchBtn);
        }
      }
    } catch {}
  }

  /**
   * Update the action button for a single leaf if it contains a MarkdownView.
   */
  updateLeaf(leaf: WorkspaceLeaf | null | undefined): void {
    if (!leaf) return;
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      this.updateView(view);
    }
  }

  /**
   * Update action buttons across all open workspace leaves.
   */
  updateAll(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.updateLeaf(leaf);
    });
  }

  /**
   * Update action buttons for leaves showing a specific file.
   */
  updateForFile(file: TFile): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file?.path === file.path) {
        this.updateView(v);
      }
    });
  }

  /**
   * Clean up all created action buttons on unload.
   */
  destroy(): void {
    for (const btn of this.createdButtons) {
      try {
        btn.remove();
      } catch {}
    }
    this.createdButtons.clear();
  }
}
