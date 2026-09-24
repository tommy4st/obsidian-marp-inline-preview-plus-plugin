import { Plugin, MarkdownView, TFile, Platform } from 'obsidian';
import { MarpEngine } from './marp/engine';
import { ThemeResolver } from './marp/themes';
import { buildReadingPostProcessor } from './reading/postProcessor';
import { buildEditorExtension, refreshSlides } from './editor/extension';
import type { EditorView } from '@codemirror/view';
import { DEBOUNCE_MS, DEFAULT_SETTINGS, MarpSettingTab, MarpSettings } from './settings';
import { openPdfExportModal } from './export/service';
import { MARP_PRESENTATION_VIEW_TYPE, MARP_PRESENTER_VIEW_TYPE } from './presentation/types';
import { MarpPresentationView } from './presentation/presentationView';
import { MarpPresenterView } from './presentation/presenterView';
import { startPresentation, openPresenterView, hasMultipleScreens } from './presentation/service';
import { HeaderActionManager, isMarpFile } from './presentation/headerAction';


export default class MarpInlinePreviewPlugin extends Plugin {
  settings: MarpSettings = { ...DEFAULT_SETTINGS };
  engine!: MarpEngine;
  themes!: ThemeResolver;
  headerActions!: HeaderActionManager;

  private marpCheckCallback(
    action: (file: TFile) => void,
    predicate?: () => boolean,
  ): (checking: boolean) => boolean {
    return (checking: boolean) => {
      if (predicate && !predicate()) return false;
      const file = this.app.workspace.getActiveFile();
      if (!isMarpFile(this.app, file)) return false;
      if (!checking && file) action(file);
      return true;
    };
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyEditPreviewWidth();

    this.engine = new MarpEngine({ math: this.settings.math === 'off' ? false : 'katex' });
    this.themes = new ThemeResolver(this.app, this.engine);
    this.headerActions = new HeaderActionManager(this.app, this);

    this.registerMarkdownPostProcessor(
      buildReadingPostProcessor({
        app: this.app,
        engine: this.engine,
        themes: this.themes,
        enabled: () => this.settings.readingPreview,
      }),
    );

    this.registerEditorExtension(
      buildEditorExtension({
        app: this.app,
        engine: this.engine,
        themes: this.themes,
        enabled: () => this.settings.editPreview,
        debounceMs: () => DEBOUNCE_MS,
        previewPosition: () => this.settings.editPreviewPosition,
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.refreshActiveEditors();
        if (file) this.headerActions.updateForFile(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && (file.path.endsWith('.css') || file.name.startsWith('.marprc'))) {
          this.themes.invalidate();
          this.refreshActiveEditors();
          this.refreshActiveReadingViews();
        }
      }),
    );

    this.registerView(
      MARP_PRESENTATION_VIEW_TYPE,
      (leaf) => new MarpPresentationView(leaf, this),
    );

    this.registerView(
      MARP_PRESENTER_VIEW_TYPE,
      (leaf) => new MarpPresenterView(leaf, this),
    );

    this.addSettingTab(new MarpSettingTab(this.app, this));

    this.addCommand({
      id: 'marp-inline-preview-refresh',
      name: 'Refresh Marp previews',
      callback: () => {
        this.themes.invalidate();
        this.refreshActiveEditors();
        this.refreshActiveReadingViews();
      },
    });

    this.addCommand({
      id: 'marp-start-presentation',
      name: 'Start presentation',
      checkCallback: this.marpCheckCallback((file) => {
        void startPresentation(this.app, this, file);
      }),
    });

    this.addCommand({
      id: 'marp-open-presenter-view',
      name: 'Open presenter view',
      checkCallback: this.marpCheckCallback((file) => {
        void openPresenterView(this.app, this, file);
      }),
    });

    this.addCommand({
      id: 'marp-export-pdf',
      name: 'Export slide deck to PDF...',
      checkCallback: this.marpCheckCallback(
        (file) => {
          openPdfExportModal(file, {
            plugin: this,
            engine: this.engine,
            themes: this.themes,
          });
        },
        () => Platform.isDesktop,
      ),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && isMarpFile(this.app, file)) {
            menu.addItem((item) => {
              item
                .setTitle('Start Marp presentation')
                .setIcon('presentation')
                .onClick(() => {
                  void startPresentation(this.app, this, file);
                });
            });

            if (hasMultipleScreens()) {
              menu.addItem((item) => {
                item
                  .setTitle('Open Marp presenter view')
                  .setIcon('presentation')
                  .onClick(() => {
                    void openPresenterView(this.app, this, file);
                  });
              });
            }

            if (Platform.isDesktop) {
              menu.addItem((item) => {
                item
                  .setTitle('Export Marp to PDF...')
                  .setIcon('file-text')
                  .onClick(() => {
                    openPdfExportModal(file, {
                      plugin: this,
                      engine: this.engine,
                      themes: this.themes,
                    });
                  });
              });
            }
          }
        }),
      );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, _editor, view) => {
        const file = view instanceof MarkdownView ? view.file : this.app.workspace.getActiveFile();
        if (file && isMarpFile(this.app, file)) {
          menu.addItem((item) => {
            item
              .setTitle('Start Marp presentation')
              .setIcon('presentation')
              .onClick(() => {
                void startPresentation(this.app, this, file);
              });
          });
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.headerActions.updateLeaf(leaf);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.headerActions.updateAll();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.headerActions.updateAll();
      }),
    );

    if (typeof this.app.workspace?.onLayoutReady === 'function') {
      this.app.workspace.onLayoutReady(() => {
        this.headerActions.updateAll();
      });
    } else {
      this.headerActions.updateAll();
    }
  }


  onunload(): void {
    this.headerActions?.destroy();
    document.body.style.removeProperty('--marp-edit-preview-max-width');
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    if (loaded && typeof loaded.limitEditPreviewWidth === 'boolean' && !loaded.editPreviewMaxWidth) {
      this.settings.editPreviewMaxWidth = loaded.limitEditPreviewWidth ? 'editor' : 'full';
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyEditPreviewWidth();
  }

  applyEditPreviewWidth(): void {
    const { editPreviewMaxWidth, customEditPreviewWidth } = this.settings;
    const width =
      editPreviewMaxWidth === 'custom'
        ? customEditPreviewWidth?.trim()
        : editPreviewMaxWidth === 'full'
          ? '100%'
          : editPreviewMaxWidth === 'editor'
            ? ''
            : editPreviewMaxWidth;

    if (width) {
      document.body.style.setProperty('--marp-edit-preview-max-width', width);
    } else {
      document.body.style.removeProperty('--marp-edit-preview-max-width');
    }
  }

  rebuildEngine(): void {
    this.engine.rebuild({ math: this.settings.math === 'off' ? false : 'katex' });
    this.themes.invalidate();
    this.refreshActiveEditors();
    this.refreshActiveReadingViews();
  }

  /** Ask every open editor's worker ViewPlugin to recompute slide widgets. */
  refreshActiveEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView) {
        // @ts-expect-error — see note in editor/extension.ts about editor.cm
        const cm = v.editor?.cm as EditorView | undefined;
        if (cm) cm.dispatch({ effects: refreshSlides.of(null) });
      }
    });
  }

  /** Force Obsidian to re-render open preview leaves, so our post-processor runs again. */
  private refreshActiveReadingViews(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.getMode() === 'preview') {
        v.previewMode?.rerender?.(true);
      }
    });
  }
}
