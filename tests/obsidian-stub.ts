export const normalizePath = (p: string): string => {
  const s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const parts = s.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
};
export class TFile {}
export class App {}
export class Modal {
  app: App;
  contentEl: HTMLElement;
  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement('div');
  }
  open(): void {}
  close(): void {}
}
export class Notice {
  constructor(_message: string, _timeout?: number) {}
  hide(): void {}
}
export const Platform = {
  isDesktop: true,
  isMobile: false,
};

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
  addChild<T extends Component>(component: T): T { return component; }
  removeChild<T extends Component>(component: T): T { return component; }
  register(cb: () => any): void {}
  registerEvent(eventRef: any): void {}
  registerInterval(id: number): number { return id; }
}

export class Plugin extends Component {
  app: App;
  manifest: any;
  constructor(app?: App, manifest?: any) {
    super();
    this.app = app || (new App());
    this.manifest = manifest || {};
  }
  async loadData(): Promise<any> { return {}; }
  async saveData(_data: any): Promise<void> {}
  addSettingTab(_tab: any): void {}
  addCommand(_command: any): any {}
}

export class Scope {
  register(_modifiers: string[], _key: string | null, _func: (evt: KeyboardEvent) => boolean | void): void {}
}

export class WorkspaceLeaf {
  view: any;
  app: App;
  constructor(app?: App) {
    this.app = app || (new App());
  }
  async setViewState(_viewState: any, _eState?: any): Promise<void> {}
  getViewState(): any { return {}; }
  detach(): void {}
}

export class ItemView extends Component {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  headerActionsEl: HTMLElement;
  scope: Scope | null = null;
  navigation = false;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    if (leaf) leaf.view = this;
    this.app = leaf?.app || new App();
    this.containerEl = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'view-header';
    this.headerActionsEl = document.createElement('div');
    this.headerActionsEl.className = 'view-actions';
    header.appendChild(this.headerActionsEl);
    this.containerEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.containerEl.appendChild(this.contentEl);
  }

  getViewType(): string { return 'item-view'; }
  getDisplayText(): string { return 'Item View'; }
  getIcon(): string { return 'document'; }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  getState(): Record<string, unknown> { return {}; }
  async setState(_state: any, _result?: any): Promise<void> {}
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const btn = document.createElement('div');
    btn.className = 'clickable-icon view-action';
    btn.setAttribute('aria-label', title);
    btn.setAttribute('data-icon', icon);
    btn.addEventListener('click', callback);
    this.headerActionsEl.appendChild(btn);
    return btn;
  }
}

export class MarkdownView extends ItemView {
  file: TFile | null = null;
  editor: any = null;
  getMode(): 'source' | 'preview' {
    return 'source';
  }
  async save(): Promise<void> {}
}

export class MenuItem {
  title: string = '';
  icon: string = '';
  onClickCb: ((evt: MouseEvent) => any) | null = null;
  setTitle(title: string): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  onClick(cb: (evt: MouseEvent) => any): this {
    this.onClickCb = cb;
    return this;
  }
}

export class Menu extends Component {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => any): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(_evt: MouseEvent): this {
    return this;
  }
  showAtPosition(_pos: any): this {
    return this;
  }
  hide(): this {
    return this;
  }
}

export class MarkdownRenderer {
  static async render(
    _app: App,
    markdown: string,
    el: HTMLElement,
    _sourcePath: string,
    _component: Component,
  ): Promise<void> {
    el.innerHTML = markdown;
  }
}

export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.setAttribute('data-icon', iconId);
}

export class PluginSettingTab {
  app: App;
  plugin: any;
  containerEl: HTMLElement;
  constructor(app: App, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.settingEl.className = 'setting-item';
    this.infoEl = document.createElement('div');
    this.infoEl.className = 'setting-item-info';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'setting-item-name';
    this.descEl = document.createElement('div');
    this.descEl.className = 'setting-item-description';
    this.controlEl = document.createElement('div');
    this.controlEl.className = 'setting-item-control';

    this.infoEl.appendChild(this.nameEl);
    this.infoEl.appendChild(this.descEl);
    this.settingEl.appendChild(this.infoEl);
    this.settingEl.appendChild(this.controlEl);
    containerEl.appendChild(this.settingEl);
  }
  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }
  addToggle(cb: (toggle: any) => any): this {
    const input = document.createElement('input');
    input.type = 'checkbox';
    this.controlEl.appendChild(input);
    let changeCb: ((v: boolean) => any) | null = null;
    input.addEventListener('change', () => {
      if (changeCb) changeCb(input.checked);
    });
    const toggleComponent = {
      setValue: (v: boolean) => {
        input.checked = v;
        return toggleComponent;
      },
      onChange: (fn: (v: boolean) => any) => {
        changeCb = fn;
        return toggleComponent;
      },
    };
    cb(toggleComponent);
    return this;
  }
  addDropdown(cb: (dropdown: any) => any): this {
    const select = document.createElement('select');
    this.controlEl.appendChild(select);
    let changeCb: ((v: any) => any) | null = null;
    select.addEventListener('change', () => {
      if (changeCb) changeCb(select.value);
    });
    const dropdown = {
      addOption: (val: string, label: string) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        select.appendChild(opt);
        return dropdown;
      },
      setValue: (v: string) => {
        select.value = v;
        return dropdown;
      },
      onChange: (fn: (v: any) => any) => {
        changeCb = fn;
        return dropdown;
      },
    };
    cb(dropdown);
    return this;
  }
  addText(cb: (text: any) => any): this {
    const input = document.createElement('input');
    input.type = 'text';
    this.controlEl.appendChild(input);
    let changeCb: ((v: string) => any) | null = null;
    input.addEventListener('input', () => {
      if (changeCb) changeCb(input.value);
    });
    const textComponent = {
      inputEl: input,
      setValue: (v: string) => {
        input.value = v;
        return textComponent;
      },
      setPlaceholder: (p: string) => {
        input.placeholder = p;
        return textComponent;
      },
      onChange: (fn: (v: string) => any) => {
        changeCb = fn;
        return textComponent;
      },
    };
    cb(textComponent);
    return this;
  }
}

