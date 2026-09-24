export type ImageQualityPreset = 'original' | 'high' | 'medium' | 'low';
export type ExportImageQuality = ImageQualityPreset;

export const IMAGE_QUALITY_OPTIONS: ReadonlyArray<readonly [ImageQualityPreset, string]> = [
  ['original', 'Original (No compression)'],
  ['high', 'High (~300 DPI, 4K max)'],
  ['medium', 'Medium (~150 DPI, 1080p max)'],
  ['low', 'Low (~96 DPI, 720p max)'],
] as const;

export interface PdfExportOptions {
  includeNotes: boolean;
  imageQuality: ImageQualityPreset;
  targetPath: string;
  openAfterExport: boolean;
}

