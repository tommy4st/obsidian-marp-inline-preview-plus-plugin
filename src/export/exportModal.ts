import { Modal, Setting, Notice, normalizePath } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import { IMAGE_QUALITY_OPTIONS, type ImageQualityPreset, type PdfExportOptions } from './types';

export class ExportPdfModal extends Modal {
  private targetPath: string;
  private includeNotes: boolean;
  private openAfterExport: boolean;
  private imageQuality: ImageQualityPreset;
  private onExport: (options: PdfExportOptions) => Promise<void>;
  private isExporting = false;

  constructor(
    private plugin: MarpInlinePreviewPlugin,
    defaultTargetPath: string,
    onExport: (options: PdfExportOptions) => Promise<void>,
  ) {
    super(plugin.app);
    this.targetPath = defaultTargetPath;
    this.includeNotes = plugin.settings.exportIncludeNotes;
    this.openAfterExport = plugin.settings.exportOpenAfter;
    this.imageQuality = plugin.settings.exportImageQuality;
    this.onExport = onExport;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Export Marp Slide Deck to PDF' });

    new Setting(contentEl)
      .setName('Output file path')
      .setDesc('Vault-relative path for the exported PDF file')
      .addText((text) =>
        text
          .setValue(this.targetPath)
          .onChange((value) => {
            this.targetPath = value.trim();
          }),
      );

    new Setting(contentEl)
      .setName('Image quality / DPI')
      .setDesc('Optimize raster images to reduce exported PDF file size')
      .addDropdown((drop) => {
        IMAGE_QUALITY_OPTIONS.forEach(([val, label]) => drop.addOption(val, label));
        drop.setValue(this.imageQuality)
          .onChange((value) => {
            this.imageQuality = value as ImageQualityPreset;
          });
      });

    new Setting(contentEl)
      .setName('Include presenter notes')
      .setDesc('Embed speaker notes as PDF sticky note annotations on each slide.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.includeNotes)
          .onChange((value) => {
            this.includeNotes = value;
          }),
      );

    new Setting(contentEl)
      .setName('Open after export')
      .setDesc('Open the exported PDF in Obsidian after completion.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.openAfterExport)
          .onChange((value) => {
            this.openAfterExport = value;
          }),
      );

    const buttonSetting = new Setting(contentEl);
    buttonSetting.addButton((btn) =>
      btn
        .setButtonText('Export')
        .setCta()
        .onClick(async () => {
          if (this.isExporting) return;
          if (!this.targetPath) {
            new Notice('Please enter a valid output file path');
            return;
          }
          let normalized = normalizePath(this.targetPath);
          if (!normalized.toLowerCase().endsWith('.pdf')) {
            normalized += '.pdf';
          }
          this.isExporting = true;
          btn.setDisabled(true);
          btn.setButtonText('Exporting...');

          // Retain user settings
          this.plugin.settings.exportIncludeNotes = this.includeNotes;
          this.plugin.settings.exportOpenAfter = this.openAfterExport;
          this.plugin.settings.exportImageQuality = this.imageQuality;
          await this.plugin.saveSettings();

          try {
            await this.onExport({
              includeNotes: this.includeNotes,
              imageQuality: this.imageQuality,
              targetPath: normalized,
              openAfterExport: this.openAfterExport,
            });
            this.close();
          } catch (e) {
            new Notice(`PDF export failed: ${(e as Error).message}`);
            btn.setDisabled(false);
            btn.setButtonText('Export');
            this.isExporting = false;
          }
        }),
    );
    buttonSetting.addButton((btn) =>
      btn
        .setButtonText('Cancel')
        .onClick(() => this.close()),
    );
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
