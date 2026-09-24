import { Notice, TFile, normalizePath } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import type { MarpEngine } from '../marp/engine';
import { resolveThemeAndMd, type ThemeResolver } from '../marp/themes';
import { rewriteImageSrcs, rewriteCssUrls } from '../util/images';
import { buildExportHtml } from './template';
import { printHtmlToPdf } from './printer';
import { annotatePdfNotes } from './notes';
import { ExportPdfModal } from './exportModal';
import type { PdfExportOptions } from './types';

export interface ExportDeps {
  plugin: MarpInlinePreviewPlugin;
  engine: MarpEngine;
  themes: ThemeResolver;
}

export function openPdfExportModal(file: TFile, deps: ExportDeps): void {
  const defaultTargetPath = file.path.replace(/\.md$/i, '.pdf');

  new ExportPdfModal(deps.plugin, defaultTargetPath, async (options) => {
    await exportDeckToPdf(file, deps, options);
  }).open();
}

export async function exportDeckToPdf(
  file: TFile,
  deps: ExportDeps,
  options: PdfExportOptions,
): Promise<void> {
  const { app } = deps.plugin;
  const notice = new Notice('Exporting Marp PDF...', 0);

  try {
    const src = await app.vault.cachedRead(file);
    const fmCache = app.metadataCache.getFileCache(file)?.frontmatter;
    const { md } = await resolveThemeAndMd(deps.themes, file, src, fmCache);

    // Single-pass render of the full slide deck with comments
    const rendered = deps.engine.render(md);
    const fullHtml = rewriteImageSrcs(rendered.html, file.path, app);
    const fullCss = rewriteCssUrls(rendered.css, file.path, app);

    const title = typeof fmCache?.title === 'string' ? fmCache.title : file.basename;
    const author = typeof fmCache?.author === 'string' ? fmCache.author : undefined;

    // 1. Build printable HTML payload
    const printPayload = buildExportHtml(fullHtml, fullCss, title);

    // 2. Print to vector PDF via offscreen webview with image optimization
    let pdfBytes = await printHtmlToPdf(printPayload, {
      imageQuality: options.imageQuality,
    });

    // 3. Post-process with pdf-lib if presenter notes requested
    if (options.includeNotes) {
      pdfBytes = await annotatePdfNotes(pdfBytes, rendered.comments, { title, author });
    }

    // 4. Save to vault
    const targetPath = normalizePath(options.targetPath);
    const existingFile = app.vault.getAbstractFileByPath(targetPath);
    const arrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    if (existingFile instanceof TFile) {
      await app.vault.modifyBinary(existingFile, arrayBuffer);
    } else {
      await app.vault.createBinary(targetPath, arrayBuffer);
    }

    notice.hide();
    new Notice(`Successfully exported PDF: ${targetPath}`, 5000);

    // 5. Optionally open the generated PDF
    if (options.openAfterExport) {
      const createdFile = app.vault.getAbstractFileByPath(targetPath);
      if (createdFile instanceof TFile) {
        await app.workspace.getLeaf(false).openFile(createdFile);
      }
    }
  } catch (err) {
    notice.hide();
    throw err;
  }
}
