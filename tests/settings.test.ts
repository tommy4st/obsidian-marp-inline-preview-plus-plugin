// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, MarpSettingTab } from '../src/settings';
import MarpInlinePreviewPlugin from '../src/main';

describe('Settings — editPreviewMaxWidth', () => {
  let plugin: any;

  beforeEach(() => {
    document.body.style.removeProperty('--marp-edit-preview-max-width');
    plugin = {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn().mockImplementation(async function (this: any) {
        this.applyEditPreviewWidth();
      }),
      applyEditPreviewWidth: MarpInlinePreviewPlugin.prototype.applyEditPreviewWidth,
      refreshActiveEditors: vi.fn(),
      loadData: vi.fn().mockResolvedValue(null),
      saveData: vi.fn().mockResolvedValue(undefined),
      loadSettings: MarpInlinePreviewPlugin.prototype.loadSettings,
    };
  });

  it('defaults editPreviewMaxWidth to "editor" and customEditPreviewWidth to "800px"', () => {
    expect(DEFAULT_SETTINGS.editPreviewMaxWidth).toBe('editor');
    expect(DEFAULT_SETTINGS.customEditPreviewWidth).toBe('800px');
  });

  it('applyEditPreviewWidth removes CSS property for "editor" so CSS fallback applies', () => {
    document.body.style.setProperty('--marp-edit-preview-max-width', '500px');
    plugin.settings.editPreviewMaxWidth = 'editor';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('');
  });

  it('applyEditPreviewWidth sets CSS property correctly for presets and custom', () => {
    plugin.settings.editPreviewMaxWidth = 'full';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('100%');

    plugin.settings.editPreviewMaxWidth = '800px';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('800px');

    plugin.settings.editPreviewMaxWidth = '1000px';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('1000px');

    plugin.settings.editPreviewMaxWidth = 'custom';
    plugin.settings.customEditPreviewWidth = '65rem';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('65rem');

    // Empty custom width should remove the property (falling back to editor width)
    plugin.settings.customEditPreviewWidth = '   ';
    plugin.applyEditPreviewWidth();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('');
  });

  it('migrates legacy limitEditPreviewWidth boolean setting', async () => {
    plugin.loadData.mockResolvedValueOnce({ limitEditPreviewWidth: true });
    await plugin.loadSettings();
    expect(plugin.settings.editPreviewMaxWidth).toBe('editor');

    plugin.loadData.mockResolvedValueOnce({ limitEditPreviewWidth: false });
    await plugin.loadSettings();
    expect(plugin.settings.editPreviewMaxWidth).toBe('full');
  });

  it('MarpSettingTab renders dropdown and toggles custom setting visibility', async () => {
    const container = document.createElement('div');
    const tab = new MarpSettingTab({} as any, plugin as any);
    (tab as any).containerEl = container;

    tab.display();

    const dropdownSettingEl = Array.from(container.querySelectorAll('.setting-item')).find((el) =>
      el.textContent?.includes('Preview slide maximum width'),
    );
    expect(dropdownSettingEl).toBeDefined();

    const customSettingEl = Array.from(container.querySelectorAll('.setting-item')).find((el) =>
      el.textContent?.includes('Custom maximum width'),
    ) as HTMLElement;
    expect(customSettingEl).toBeDefined();

    // Verify custom input is initially hidden when mode is 'editor'
    expect(customSettingEl.style.display).toBe('none');

    // Select 'custom' in dropdown
    const select = dropdownSettingEl?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeDefined();
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.settings.editPreviewMaxWidth).toBe('custom');
    expect(customSettingEl.style.display).toBe('');
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.refreshActiveEditors).toHaveBeenCalled();

    // Enter custom width
    const textInput = customSettingEl.querySelector('input[type=\"text\"]') as HTMLInputElement;
    expect(textInput).toBeDefined();
    textInput.value = '950px';
    textInput.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.settings.customEditPreviewWidth).toBe('950px');
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('950px');

    // Switch back to 800px preset
    select.value = '800px';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.settings.editPreviewMaxWidth).toBe('800px');
    expect(customSettingEl.style.display).toBe('none');
    expect(document.body.style.getPropertyValue('--marp-edit-preview-max-width')).toBe('800px');
  });
});

describe('Settings — editPreviewPosition', () => {
  it('defaults to "before-divider" and updates when changing dropdown', async () => {
    expect(DEFAULT_SETTINGS.editPreviewPosition).toBe('before-divider');

    const plugin: any = {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      refreshActiveEditors: vi.fn(),
    };
    const container = document.createElement('div');
    const tab = new MarpSettingTab({} as any, plugin);
    (tab as any).containerEl = container;
    tab.display();

    const item = Array.from(container.querySelectorAll('.setting-item')).find((el) =>
      el.textContent?.includes('Preview slide position'),
    );
    expect(item).toBeDefined();
    const select = item?.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('before-divider');

    select.value = 'top';
    select.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.settings.editPreviewPosition).toBe('top');
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.refreshActiveEditors).toHaveBeenCalled();
  });
});

describe('Settings — laser pointer duration', () => {
  it('defaults to 1.5s and updates when entering seconds', async () => {
    expect(DEFAULT_SETTINGS.laserDecayDuration).toBe(1.5);

    const plugin: any = {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };
    const container = document.createElement('div');
    const tab = new MarpSettingTab({} as any, plugin);
    (tab as any).containerEl = container;
    tab.display();

    const item = Array.from(container.querySelectorAll('.setting-item')).find((el) =>
      el.textContent?.includes('Laser pointer decay duration'),
    );
    const input = item?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('1.5');

    input.value = '2.5';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));

    expect(plugin.settings.laserDecayDuration).toBe(2.5);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });
});
