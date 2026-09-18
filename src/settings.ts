import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarpInlinePreviewPlugin from './main';

export type ExportImageQuality = 'original' | 'high' | 'medium' | 'low';

export type EditPreviewMaxWidth =
  | 'editor'
  | '800px'
  | '1000px'
  | 'full'
  | 'custom';

export interface MarpSettings {
  editPreview: boolean;
  editPreviewMaxWidth: EditPreviewMaxWidth;
  customEditPreviewWidth: string;
  limitEditPreviewWidth?: boolean;
  readingPreview: boolean;
  math: 'katex' | 'off';
  exportIncludeNotes: boolean;
  exportOpenAfter: boolean;
  exportImageQuality: ExportImageQuality;
  autoOpenPresenterView: boolean;
  showViewHeaderButton: boolean;
  laserDecayDuration: number;
}

export const DEFAULT_SETTINGS: MarpSettings = {
  editPreview: true,
  editPreviewMaxWidth: 'editor',
  customEditPreviewWidth: '800px',
  readingPreview: true,
  math: 'katex',
  exportIncludeNotes: false,
  exportOpenAfter: true,
  exportImageQuality: 'medium',
  autoOpenPresenterView: false,
  showViewHeaderButton: true,
  laserDecayDuration: 1.5,
};


/** Fixed debounce for edit-mode rebuilds. Was tunable via settings; pinned here. */
export const DEBOUNCE_MS = 300;

export class MarpSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MarpInlinePreviewPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Marp Inline Preview' });
    containerEl.createEl('p', {
      text: 'Only files with `marp: true` in their YAML frontmatter are processed.',
    });

    new Setting(containerEl)
      .setName('Inline preview in edit mode')
      .setDesc('Show each slide rendered below its --- separator in the editor.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.editPreview).onChange(async (v) => {
          this.plugin.settings.editPreview = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Preview slide maximum width')
      .setDesc('Maximum width of preview slides in edit mode.')
      .addDropdown((d) =>
        d
          .addOption('editor', 'Match editor line width (default)')
          .addOption('800px', '800px')
          .addOption('1000px', '1000px')
          .addOption('full', 'Full width (100%)')
          .addOption('custom', 'Custom width...')
          .setValue(this.plugin.settings.editPreviewMaxWidth)
          .onChange(async (v: EditPreviewMaxWidth) => {
            customSetting.settingEl.style.display = v === 'custom' ? '' : 'none';
            this.plugin.settings.editPreviewMaxWidth = v;
            await this.plugin.saveSettings();
            this.plugin.refreshActiveEditors();
          }),
      );

    const customSetting = new Setting(containerEl)
      .setName('Custom maximum width')
      .setDesc('Specify any CSS width (e.g. 850px, 50rem, 75%).')
      .addText((text) =>
        text
          .setPlaceholder('e.g. 850px')
          .setValue(this.plugin.settings.customEditPreviewWidth)
          .onChange(async (v) => {
            this.plugin.settings.customEditPreviewWidth = v;
            await this.plugin.saveSettings();
            this.plugin.refreshActiveEditors();
          }),
      );

    customSetting.settingEl.style.display =
      this.plugin.settings.editPreviewMaxWidth === 'custom' ? '' : 'none';

    new Setting(containerEl)
      .setName('Full preview in reading mode')
      .setDesc('Replace the rendered markdown with the full Marp deck.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.readingPreview).onChange(async (v) => {
          this.plugin.settings.readingPreview = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Math rendering')
      .setDesc('KaTeX is bundled. Disable to skip math entirely.')
      .addDropdown((d) =>
        d
          .addOption('katex', 'KaTeX')
          .addOption('off', 'Off')
          .setValue(this.plugin.settings.math)
          .onChange(async (v: 'katex' | 'off') => {
            this.plugin.settings.math = v;
            await this.plugin.saveSettings();
            this.plugin.rebuildEngine();
          }),
      );

    containerEl.createEl('h3', { text: 'PDF Export' });

    new Setting(containerEl)
      .setName('Include presenter notes')
      .setDesc('Add presenter notes as PDF sticky note annotations by default.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportIncludeNotes).onChange(async (v) => {
          this.plugin.settings.exportIncludeNotes = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Open PDF after export')
      .setDesc('Open the exported PDF in Obsidian by default after completion.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.exportOpenAfter).onChange(async (v) => {
          this.plugin.settings.exportOpenAfter = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Default image quality / DPI')
      .setDesc('Optimize raster image resolution and compression to reduce PDF file size.')
      .addDropdown((d) =>
        d
          .addOption('original', 'Original (No compression)')
          .addOption('high', 'High (~300 DPI, 4K max)')
          .addOption('medium', 'Medium (~150 DPI, 1080p max)')
          .addOption('low', 'Low (~96 DPI, 720p max)')
          .setValue(this.plugin.settings.exportImageQuality)
          .onChange(async (v: ExportImageQuality) => {
            this.plugin.settings.exportImageQuality = v;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'Presentation' });

    new Setting(containerEl)
      .setName('Auto-open presenter view')
      .setDesc('Automatically open the Presenter View in an Obsidian tab when starting a presentation.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpenPresenterView).onChange(async (v) => {
          this.plugin.settings.autoOpenPresenterView = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Show presentation button in note header')
      .setDesc('Show a button next to the reading/editing switcher to start the presentation.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showViewHeaderButton).onChange(async (v) => {
          this.plugin.settings.showViewHeaderButton = v;
          await this.plugin.saveSettings();
          this.plugin.headerActions?.updateAll();
        }),
      );

    new Setting(containerEl)
      .setName('Laser pointer decay duration')
      .setDesc('Duration in seconds the laser stroke remains visible before fading.')
      .addText((text) =>
        text
          .setPlaceholder('1.5')
          .setValue(String(this.plugin.settings.laserDecayDuration))
          .onChange(async (v) => {
            const num = parseFloat(v);
            if (num > 0) {
              this.plugin.settings.laserDecayDuration = num;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}

