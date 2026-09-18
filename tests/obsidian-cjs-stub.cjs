// CJS stub of the runtime `obsidian` module — used only by the bundle smoke
// test that loads the built main.js inside Node. The vitest source tests use
// tests/obsidian-stub.ts for src/ imports; this file is for the bundled CJS
// require("obsidian") calls.

class App {}
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerView() {}
  registerEvent() {}
  addSettingTab() {}
  addCommand() {}
  async loadData() { return null; }
  async saveData() {}
}
class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
class Setting {
  constructor() { return this; }
  setName() { return this; }
  setDesc() { return this; }
  addText(cb) { cb?.(this); return this; }
  addToggle(cb) { cb?.(this); return this; }
  addDropdown(cb) { cb?.(this); return this; }
  addButton(cb) { cb?.(this); return this; }
  addOption() { return this; }
  setValue() { return this; }
  onChange() { return this; }
  setButtonText() { return this; }
  setCta() { return this; }
  setDisabled() { return this; }
  onClick() { return this; }
}
class MenuItem {
  constructor() {
    this.title = '';
    this.icon = '';
    this.callback = null;
  }
  setTitle(t) { this.title = t; return this; }
  setIcon(i) { this.icon = i; return this; }
  onClick(cb) { this.callback = cb; return this; }
}

class Menu {
  constructor() {
    this.items = [];
  }
  addItem(cb) {
    const item = new MenuItem();
    cb?.(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent() { return this; }
  showAtPosition() { return this; }
  hide() { return this; }
}

class MarkdownView {}
class TFile {}
class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = {
      empty() {},
      createEl() { return {}; },
    };
  }
  open() {}
  close() {}
}
class Notice {
  constructor() {}
  hide() {}
}
const Platform = {
  isDesktop: true,
  isMobile: false,
};

class Component {
  load() {}
  onload() {}
  unload() {}
  onunload() {}
  addChild(c) { return c; }
  removeChild(c) { return c; }
  register() {}
  registerEvent() {}
  registerInterval(id) { return id; }
}

class Scope {
  register() {}
}

class WorkspaceLeaf {
  constructor(app) {
    this.app = app;
  }
  async setViewState() {}
  getViewState() { return {}; }
  detach() {}
}

class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf?.app;
    this.containerEl = {
      createEl() { return {}; },
      createDiv() { return {}; },
      appendChild() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; } },
      style: {},
      addEventListener() {},
      removeEventListener() {},
    };
    this.contentEl = this.containerEl;
    this.navigation = false;
    this.scope = null;
  }
  getViewType() { return 'item-view'; }
  getDisplayText() { return 'Item View'; }
  getIcon() { return 'document'; }
  async onOpen() {}
  async onClose() {}
  getState() { return {}; }
  async setState() {}
  addAction() { return {}; }
}

class MarkdownRenderer {
  static async render(_app, markdown, el) {
    if (el) el.innerHTML = markdown;
  }
}

function setIcon(parent, iconId) {
  if (parent?.setAttribute) parent.setAttribute('data-icon', iconId);
}

function normalizePath(p) {
  let s = String(p || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

module.exports = {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Menu,
  MenuItem,
  MarkdownView,
  TFile,
  Modal,
  Notice,
  Platform,
  Component,
  Scope,
  WorkspaceLeaf,
  ItemView,
  MarkdownRenderer,
  setIcon,
  normalizePath,
};

