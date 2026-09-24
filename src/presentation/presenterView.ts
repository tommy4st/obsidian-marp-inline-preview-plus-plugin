import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type MarpInlinePreviewPlugin from '../main';
import { SLIDE_H, SLIDE_W } from '../util/frame';
import { PresentationSession } from './session';
import {
  MARP_PRESENTER_VIEW_TYPE,
  PresentationTimerState,
  SlideDeckData,
  createIconButton,
  createSlideIframe,
  formatClockTime,
  formatTime,
  handleBasePresentationKey,
  initializeDeckSession,
  isEditableElement,
  isViewInFocus,
  loadSlideDeck,
  safePaintFrame,
} from './types';

export class MarpPresenterView extends ItemView {
  public file: TFile | null = null;
  public session: PresentationSession | null = null;
  private deck: SlideDeckData | null = null;

  // Header Elements
  private timerDisplayEl!: HTMLElement;
  private timerToggleBtn!: HTMLElement;
  private clockDisplayEl!: HTMLElement;
  private slideSelectEl!: HTMLSelectElement;

  // Preview Elements
  private currentIframe!: HTMLIFrameElement;
  private nextIframe!: HTMLIFrameElement;
  private currentSlideWrapper!: HTMLElement;
  private nextSlideWrapper!: HTMLElement;

  // Notes Elements
  private notesContainerEl!: HTMLElement;
  private notesFontSize = 18;

  // Nav & Status Buttons
  private prevBtn!: HTMLElement;
  private nextBtn!: HTMLElement;
  private blackoutBtn!: HTMLElement;
  private whiteoutBtn!: HTMLElement;

  private unsubs: Array<() => void> = [];
  private clockInterval: any = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MarpInlinePreviewPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return MARP_PRESENTER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? `Presenter: ${this.file.basename}` : 'Marp Presenter View';
  }

  getIcon(): string {
    return 'presentation';
  }

  getState(): Record<string, unknown> {
    return {
      filePath: this.file?.path,
      slideIndex: this.session?.currentSlide ?? 0,
    };
  }

  async setState(state: any, _result: any): Promise<void> {
    if (state?.filePath) {
      const abstractFile = this.app.vault.getAbstractFileByPath(state.filePath);
      if (abstractFile instanceof TFile) {
        await this.loadFile(abstractFile, state.slideIndex ?? 0);
      }
    }
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('marp-presenter-view');
    contentEl.tabIndex = 0;

    this.buildHeader(contentEl);

    const mainGrid = contentEl.createDiv({ cls: 'marp-presenter-grid' });
    this.buildSlidePreviews(mainGrid);
    this.buildNotesPane(mainGrid);

    this.buildFooter(contentEl);

    this.setupKeyboardNavigation(contentEl);
    this.setupPreviewScaling(contentEl);
    this.startWallClock();

    if (this.deck) {
      this.populateSlideDropdown();
      this.renderCurrentAndNextSlide();
      void this.renderSpeakerNotes();
      this.updateControls();
    }

    const fileModifyRef = this.app.vault.on('modify', async (modifiedFile) => {
      if (this.file && modifiedFile.path === this.file.path) {
        await this.reloadDeck();
      }
    });
    this.registerEvent(fileModifyRef);

    contentEl.focus();
  }

  async onClose(): Promise<void> {
    this.cleanup();
  }

  public async loadFile(file: TFile, initialSlideIndex = 0): Promise<void> {
    this.file = file;
    await this.reloadDeck(initialSlideIndex);
  }

  private async reloadDeck(initialSlideIndex?: number): Promise<void> {
    if (!this.file) return;

    try {
      const { deck, session } = await initializeDeckSession(
        this.plugin,
        this.file,
        this.session,
        initialSlideIndex,
        (s) => this.attachSessionListeners(s),
      );
      this.deck = deck;
      this.session = session;

      this.populateSlideDropdown();
      this.renderCurrentAndNextSlide();
      void this.renderSpeakerNotes();
      this.updateControls();
    } catch (err) {
      console.error('[marp-presenter] failed to reload deck', err);
    }
  }

  private attachSessionListeners(session = this.session): void {
    if (!session) return;
    this.session = session;

    this.unsubs.push(
      session.on('slide-change', () => {
        this.renderCurrentAndNextSlide();
        void this.renderSpeakerNotes();
        this.updateControls();
      }),
      session.on('timer-tick', (timer) => this.updateTimerDisplay(timer)),
      session.on('blank-change', (blank) => this.updateBlankButtons(blank)),
      session.on('destroy', () => {
        this.session = null;
      }),
    );
  }

  private buildHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'marp-presenter-header' });

    // Timer
    const timerBox = header.createDiv({ cls: 'marp-presenter-timer-box' });
    this.timerDisplayEl = timerBox.createDiv({
      cls: 'marp-presenter-timer-text',
      text: '00:00:00',
    });

    this.timerToggleBtn = createIconButton(timerBox, 'marp-presenter-icon-btn', 'play', 'Start / Pause Timer', () => {
      if (this.session?.timer.isRunning) {
        this.session.pauseTimer();
      } else {
        this.session?.startTimer();
      }
    });

    createIconButton(timerBox, 'marp-presenter-icon-btn', 'rotate-ccw', 'Reset Timer', () => {
      this.session?.resetTimer();
    });

    // Slide Quick Selector
    const selectorBox = header.createDiv({ cls: 'marp-presenter-select-box' });
    this.slideSelectEl = selectorBox.createEl('select', { cls: 'marp-presenter-select' });
    this.slideSelectEl.onchange = () => {
      const val = Number(this.slideSelectEl.value);
      if (Number.isFinite(val)) {
        this.session?.goTo(val);
      }
    };

    // Wall Clock
    const clockBox = header.createDiv({ cls: 'marp-presenter-clock-box' });
    this.clockDisplayEl = clockBox.createDiv({
      cls: 'marp-presenter-clock-text',
      text: '--:--:--',
    });
  }

  private buildSlidePreviews(container: HTMLElement): void {
    const leftCol = container.createDiv({ cls: 'marp-presenter-previews-col' });

    const createSlideCard = (title: string) => {
      const card = leftCol.createDiv({ cls: 'marp-presenter-slide-card' });
      card.createDiv({ cls: 'marp-presenter-card-title', text: title });
      const viewport = card.createDiv({ cls: 'marp-presenter-viewport' });
      const wrapper = viewport.createDiv({ cls: 'marp-presenter-slide-wrapper' });
      wrapper.style.width = `${SLIDE_W}px`;
      wrapper.style.height = `${SLIDE_H}px`;
      const iframe = createSlideIframe();
      wrapper.appendChild(iframe);
      return { wrapper, iframe };
    };

    const current = createSlideCard('Current Slide (Audience)');
    this.currentSlideWrapper = current.wrapper;
    this.currentIframe = current.iframe;

    const next = createSlideCard('Next Slide');
    this.nextSlideWrapper = next.wrapper;
    this.nextIframe = next.iframe;
  }

  private buildNotesPane(container: HTMLElement): void {
    const rightCol = container.createDiv({ cls: 'marp-presenter-notes-col' });
    const notesCard = rightCol.createDiv({ cls: 'marp-presenter-notes-card' });

    const notesHeader = notesCard.createDiv({ cls: 'marp-presenter-notes-header' });
    notesHeader.createDiv({ cls: 'marp-presenter-card-title', text: 'Speaker Notes' });

    const fontControls = notesHeader.createDiv({ cls: 'marp-presenter-font-controls' });
    fontControls
      .createEl('button', { cls: 'marp-presenter-icon-btn', text: 'A-', attr: { title: 'Decrease Font Size' } })
      .onclick = () => this.adjustNotesFontSize(-2);
    fontControls
      .createEl('button', { cls: 'marp-presenter-icon-btn', text: 'A+', attr: { title: 'Increase Font Size' } })
      .onclick = () => this.adjustNotesFontSize(2);

    this.notesContainerEl = notesCard.createDiv({ cls: 'marp-presenter-notes-content' });
    this.notesContainerEl.style.fontSize = `${this.notesFontSize}px`;
  }

  private buildFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'marp-presenter-footer' });

    // Nav Group
    const navGroup = footer.createDiv({ cls: 'marp-presenter-btn-group' });
    createIconButton(navGroup, 'marp-presenter-icon-btn', 'chevrons-left', 'First Slide (Home)', () => {
      this.session?.first();
    });
    this.prevBtn = createIconButton(navGroup, 'marp-presenter-icon-btn', 'chevron-left', 'Previous Slide (Left Arrow)', () => {
      this.session?.prev();
    });
    this.nextBtn = createIconButton(navGroup, 'marp-presenter-icon-btn', 'chevron-right', 'Next Slide (Right Arrow / Space)', () => {
      this.session?.next();
    });
    createIconButton(navGroup, 'marp-presenter-icon-btn', 'chevrons-right', 'Last Slide (End)', () => {
      this.session?.last();
    });

    // Blank Screen Controls
    const blankGroup = footer.createDiv({ cls: 'marp-presenter-btn-group' });
    this.blackoutBtn = blankGroup.createEl('button', {
      cls: 'marp-presenter-toggle-btn',
      text: 'Black Screen (B)',
    });
    this.blackoutBtn.onclick = () => this.session?.toggleBlackout();

    this.whiteoutBtn = blankGroup.createEl('button', {
      cls: 'marp-presenter-toggle-btn',
      text: 'White Screen (W)',
    });
    this.whiteoutBtn.onclick = () => this.session?.toggleWhiteout();

    // Status Badge
    const statusBox = footer.createDiv({ cls: 'marp-presenter-status' });
    statusBox.createDiv({ cls: 'marp-presenter-badge', text: '● Audience Synced' });
  }

  private renderCurrentAndNextSlide(): void {
    if (!this.deck || !this.session) return;
    const cur = this.session.currentSlide;

    const currentHtml =
      this.deck.slides[cur] ??
      '<div class="marp-inline-preview"><section><h1>End of Deck</h1></section></div>';
    safePaintFrame(this.currentIframe, currentHtml, this.deck.css);

    const nextHtml =
      cur + 1 < this.deck.slides.length
        ? this.deck.slides[cur + 1]
        : '<div class="marp-inline-preview"><section style="display:flex;align-items:center;justify-content:center;height:100%;"><p style="color:#888;font-size:36px;">End of Presentation</p></section></div>';
    safePaintFrame(this.nextIframe, nextHtml, this.deck.css);

    this.applyPreviewScaling();
  }

  private async renderSpeakerNotes(): Promise<void> {
    if (!this.deck || !this.session || !this.file) return;
    const notes = (this.deck.comments[this.session.currentSlide] ?? []).join('\n\n').trim();

    this.notesContainerEl.empty();
    if (!notes) {
      this.notesContainerEl.createDiv({
        cls: 'marp-presenter-no-notes',
        text: 'No speaker notes for this slide.',
      });
      return;
    }

    try {
      await MarkdownRenderer.render(this.app, notes, this.notesContainerEl, this.file.path, this);
    } catch {
      this.notesContainerEl.setText(notes);
    }
  }

  private adjustNotesFontSize(delta: number): void {
    this.notesFontSize = Math.max(12, Math.min(36, this.notesFontSize + delta));
    if (this.notesContainerEl) {
      this.notesContainerEl.style.fontSize = `${this.notesFontSize}px`;
    }
  }

  private populateSlideDropdown(): void {
    if (!this.deck || !this.slideSelectEl) return;
    this.slideSelectEl.empty();
    for (let i = 0; i < this.deck.slides.length; i++) {
      const opt = this.slideSelectEl.createEl('option', {
        value: String(i),
        text: `Slide ${i + 1} of ${this.deck.slides.length}`,
      });
      if (this.session && i === this.session.currentSlide) {
        opt.selected = true;
      }
    }
  }

  private updateControls(): void {
    if (!this.session) return;
    if (this.slideSelectEl) {
      this.slideSelectEl.value = String(this.session.currentSlide);
    }
    this.prevBtn?.toggleAttribute('disabled', this.session.currentSlide === 0);
    this.nextBtn?.toggleAttribute('disabled', this.session.currentSlide >= this.session.totalSlides - 1);
  }

  private updateBlankButtons(blank: 'none' | 'black' | 'white'): void {
    this.blackoutBtn?.toggleClass('is-active', blank === 'black');
    this.whiteoutBtn?.toggleClass('is-active', blank === 'white');
  }

  private updateTimerDisplay(timer: PresentationTimerState): void {
    if (!this.timerDisplayEl) return;
    this.timerDisplayEl.textContent = formatTime(timer.elapsedSeconds);
    if (this.timerToggleBtn) {
      setIcon(this.timerToggleBtn, timer.isRunning ? 'pause' : 'play');
    }
  }

  private startWallClock(): void {
    const update = () => {
      if (this.clockDisplayEl) {
        this.clockDisplayEl.textContent = formatClockTime();
      }
    };
    update();
    this.clockInterval = setInterval(update, 1000);
  }

  public isPopout(): boolean {
    const doc = this.containerEl.ownerDocument;
    return doc !== undefined && doc !== document;
  }

  public isViewInFocus(): boolean {
    return isViewInFocus(this);
  }

  private setupKeyboardNavigation(container: HTMLElement): void {
    const doc = container.ownerDocument || document;

    const handleKeydown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target as Element)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (handleBasePresentationKey(e, this.session)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.leaf.detach();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!this.session) return;
      if (isEditableElement(e.target as Element)) return;
      if (!this.isViewInFocus()) return;
      if ((e as any)._marpHandled) return;
      (e as any)._marpHandled = true;
      handleKeydown(e);
    };

    doc.addEventListener('keydown', onKey);
    container.addEventListener('keydown', onKey);

    this.unsubs.push(() => {
      doc.removeEventListener('keydown', onKey);
      container.removeEventListener('keydown', onKey);
    });
  }

  private applyPreviewScaling(): void {
    for (const wrapper of [this.currentSlideWrapper, this.nextSlideWrapper]) {
      const parent = wrapper?.parentElement;
      if (!parent || !wrapper) continue;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w > 0 && h > 0) {
        const scale = Math.min(w / SLIDE_W, h / SLIDE_H);
        wrapper.style.transform = `translate(-50%, -50%) scale(${scale})`;
      }
    }
  }

  private setupPreviewScaling(container: HTMLElement): void {
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this.applyPreviewScaling());
    });
    this.resizeObserver.observe(container);
    if (this.currentSlideWrapper?.parentElement) {
      this.resizeObserver.observe(this.currentSlideWrapper.parentElement);
    }
    if (this.nextSlideWrapper?.parentElement) {
      this.resizeObserver.observe(this.nextSlideWrapper.parentElement);
    }
    this.applyPreviewScaling();
  }

  private cleanup(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.session?.release();
    this.session = null;
  }
}
