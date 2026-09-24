import { ItemView, Platform, TFile, WorkspaceLeaf } from "obsidian";
import type MarpInlinePreviewPlugin from "../main";
import { SLIDE_H, SLIDE_W } from "../util/frame";
import { PresentationSession } from "./session";
import {
  MARP_PRESENTATION_VIEW_TYPE,
  SlideDeckData,
  createIconButton,
  createSlideIframe,
  handleBasePresentationKey,
  initializeDeckSession,
  isEditableElement,
  isViewInFocus,
  safePaintFrame,
} from "./types";
import { hasMultipleScreens, observeScreenChanges, openPresenterView } from "./service";

const HUD_AUTOHIDE_MS = 2500;
const END_OF_DECK_HTML = '<div class="marp-inline-preview"><section><h1>End of Deck</h1></section></div>';

/** Toggle the Capacitor status bar so fullscreen is truly edge-to-edge on mobile. */
async function setMobileStatusBar(visible: boolean): Promise<void> {
  try {
    const bar = (globalThis as any).Capacitor?.Plugins?.StatusBar;
    if (!bar) return;
    await (visible ? bar.show() : bar.hide());
    await bar.setOverlaysWebView?.({ overlay: !visible });
  } catch (err) {
    console.debug(`[marp-presentation] setMobileStatusBar(${visible}) error:`, err);
  }
}

export class MarpPresentationView extends ItemView {
  public file: TFile | null = null;
  public session: PresentationSession | null = null;
  private deck: SlideDeckData | null = null;

  private slideWrapperEl!: HTMLElement;
  private iframe!: HTMLIFrameElement;
  private blankOverlayEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private hudCounterEl!: HTMLElement;
  private presenterBtn: HTMLElement | null = null;
  private hudHideTimeout?: ReturnType<typeof setTimeout>;
  private unsubs: Array<() => void> = [];
  private touchStartX = 0;
  private touchStartY = 0;
  private lastTouchSwipeTime = 0;
  private isExiting = false;

  constructor(leaf: WorkspaceLeaf, private plugin: MarpInlinePreviewPlugin) {
    super(leaf);
    this.navigation = false;
  }

  getViewType(): string {
    return MARP_PRESENTATION_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file ? `Presentation: ${this.file.basename}` : "Marp Presentation";
  }

  getIcon(): string {
    return "presentation";
  }

  getState(): Record<string, unknown> {
    return {
      filePath: this.file?.path,
      slideIndex: this.session?.currentSlide ?? 0,
    };
  }

  async setState(state: any): Promise<void> {
    if (!state?.filePath) return;
    const file = this.app.vault.getAbstractFileByPath(state.filePath);
    if (file instanceof TFile) await this.loadFile(file, state.slideIndex ?? 0);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("marp-presentation-view");
    contentEl.tabIndex = 0;

    const stageEl = contentEl.createDiv({ cls: "marp-presentation-stage" });
    this.slideWrapperEl = stageEl.createDiv({ cls: "marp-presentation-slide-wrapper" });
    this.slideWrapperEl.style.width = `${SLIDE_W}px`;
    this.slideWrapperEl.style.height = `${SLIDE_H}px`;
    this.iframe = createSlideIframe();
    this.slideWrapperEl.appendChild(this.iframe);

    this.blankOverlayEl = contentEl.createDiv({ cls: "marp-presentation-blank-overlay" });

    this.buildHud();
    this.setupKeyboardNavigation();
    this.setupClickNavigation();
    this.setupTouchNavigation();
    this.setupAutoScaling();

    if (this.deck) {
      this.renderCurrentSlide();
      this.updateHud();
    }

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === this.file?.path) void this.reloadDeck();
      }),
    );

    void this.enterFullscreen();
    this.focusContent();
    setTimeout(() => this.focusContent(), 50);
    setTimeout(() => this.focusContent(), 150);
  }

  async onClose(): Promise<void> {
    this.isExiting = true;
    void this.exitFullscreen();
    this.cleanup();
  }

  public async loadFile(file: TFile, initialSlideIndex = 0): Promise<void> {
    this.file = file;
    await this.reloadDeck(initialSlideIndex);
  }

  public isPopout(): boolean {
    return this.containerEl.ownerDocument !== document;
  }

  public updatePresenterButtonVisibility(): void {
    if (!this.presenterBtn) return;
    this.presenterBtn.style.display = hasMultipleScreens(this.viewWindow) ? "" : "none";
  }

  public async enterFullscreen(retries = Platform.isDesktop ? 6 : 0): Promise<boolean> {
    try {
      await setMobileStatusBar(false);
      const win = this.viewWindow as any;

      // Desktop Obsidian: Electron's native window fullscreen is the most reliable.
      if (typeof win.electronWindow?.setFullScreen === "function") {
        if (!win.electronWindow.isFullScreen?.()) win.electronWindow.setFullScreen(true);
        return true;
      }

      const doc = this.containerEl.ownerDocument || document;
      if (doc.fullscreenElement) return true;

      const target = Platform.isDesktop ? this.containerEl : doc.documentElement;
      if (typeof target.requestFullscreen !== "function") return false;
      await target.requestFullscreen({ navigationUI: "hide" });
      return true;
    } catch {
      // requestFullscreen can reject transiently (e.g. missing user gesture) — retry briefly.
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.enterFullscreen(retries - 1);
      }
      return false;
    }
  }

  public async exitFullscreen(): Promise<void> {
    try {
      await setMobileStatusBar(true);
      const win = this.viewWindow as any;
      if (win.electronWindow?.isFullScreen?.()) win.electronWindow.setFullScreen(false);
      const doc = this.containerEl.ownerDocument || document;
      if (doc.fullscreenElement) await doc.exitFullscreen();
    } catch {}
  }

  public async exitPresentation(): Promise<void> {
    if (this.isExiting) return;
    this.isExiting = true;
    await this.exitFullscreen();
    const win = this.containerEl.ownerDocument?.defaultView;
    this.leaf.detach();
    if (this.isPopout() && win && win !== window && !win.closed) (win as any).close?.();
  }

  private get viewWindow(): Window {
    return (this.contentEl?.ownerDocument?.defaultView || window) as Window;
  }

  /** Add a listener and push its remover onto `unsubs` for cleanup. */
  private listen(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.unsubs.push(() => target.removeEventListener(type, handler, options));
  }

  private focusContent(): void {
    try {
      (this.contentEl.ownerDocument.defaultView || window).focus();
      this.contentEl.focus();
    } catch {}
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
      this.renderCurrentSlide();
      this.updateHud();
    } catch (err) {
      console.error("[marp-presentation] failed to render slide deck", err);
    }
  }

  private attachSessionListeners(session: PresentationSession): void {
    this.session = session;
    this.unsubs.push(
      session.on("slide-change", () => {
        this.renderCurrentSlide();
        this.updateHud();
      }),
      session.on("blank-change", (blank) => this.updateBlankOverlay(blank)),
      session.on("destroy", () => (this.session = null)),
    );
  }

  private renderCurrentSlide(): void {
    if (!this.deck || !this.session) return;
    const slideHtml = this.deck.slides[this.session.currentSlide] ?? END_OF_DECK_HTML;
    safePaintFrame(this.iframe, slideHtml, this.deck.css);
  }

  private updateBlankOverlay(blank: "none" | "black" | "white"): void {
    this.blankOverlayEl.toggleClass("is-blackout", blank === "black");
    this.blankOverlayEl.toggleClass("is-whiteout", blank === "white");
  }

  private buildHud(): void {
    const container = this.contentEl;
    this.hudEl = container.createDiv({ cls: "marp-presentation-hud" });
    this.hudCounterEl = this.hudEl.createDiv({ cls: "marp-presentation-hud-counter", text: "Slide 1 / 1" });

    const navBtn = (icon: string, title: string, onClick: () => void) =>
      createIconButton(this.hudEl, "marp-presentation-hud-btn", icon, title, (e) => {
        e.stopPropagation();
        onClick();
      });

    navBtn("chevron-left", "Previous Slide (Left Arrow)", () => this.session?.prev());
    navBtn("chevron-right", "Next Slide (Right Arrow / Space)", () => this.session?.next());
    this.presenterBtn = navBtn("presentation", "Open Presenter View (P)", () => this.openPresenter());
    this.updatePresenterButtonVisibility();
    this.unsubs.push(observeScreenChanges(() => this.updatePresenterButtonVisibility(), this.viewWindow));
    navBtn("x", "Exit Presentation (Esc)", () => void this.exitPresentation());

    this.listen(container, "mousemove", () => this.showHudTemporarily());
    this.listen(container, "pointerleave", (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        this.hudEl.removeClass("is-visible");
        this.contentEl.addClass("is-cursor-hidden");
      }
    });
    this.showHudTemporarily();
  }

  private openPresenter(): void {
    if (!this.file) return;
    void openPresenterView(this.app, this.plugin, this.file, {
      slideIndex: this.session?.currentSlide ?? 0,
    });
  }

  private showHudTemporarily(): void {
    this.updatePresenterButtonVisibility();
    this.hudEl.addClass("is-visible");
    this.contentEl.removeClass("is-cursor-hidden");
    clearTimeout(this.hudHideTimeout);
    this.hudHideTimeout = setTimeout(() => {
      try {
        // Stay visible while the pointer rests on the HUD.
        if (this.hudEl.matches(":hover")) return this.showHudTemporarily();
      } catch {}
      this.hudEl.removeClass("is-visible");
      this.contentEl.addClass("is-cursor-hidden");
    }, HUD_AUTOHIDE_MS);
  }

  private updateHud(): void {
    if (!this.hudCounterEl || !this.session) return;
    this.hudCounterEl.textContent = `Slide ${this.session.currentSlide + 1} / ${this.session.totalSlides}`;
  }

  private isViewInFocus(): boolean {
    return isViewInFocus(this);
  }

  private setupKeyboardNavigation(): void {
    const onKey = (e: KeyboardEvent) => {
      if (!this.session || (e as any)._marpHandled || !this.isViewInFocus()) return;
      if (isEditableElement(e.target as Element) || e.ctrlKey || e.metaKey || e.altKey) return;
      (e as any)._marpHandled = true;

      if (handleBasePresentationKey(e, this.session)) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (hasMultipleScreens(this.viewWindow)) this.openPresenter();
      } else if (e.key === "Escape") {
        e.preventDefault();
        void this.exitPresentation();
      }
    };

    // Container listener catches non-bubbling dispatches; document listener catches the rest.
    this.listen(this.contentEl, "keydown", onKey);
    this.listen(this.contentEl.ownerDocument || document, "keydown", onKey);
  }

  private setupClickNavigation(): void {
    this.listen(this.contentEl, "click", (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest(".marp-presentation-hud")) return;
      if (Date.now() - this.lastTouchSwipeTime < 350) return; // ignore the click that follows a swipe
      if (this.session?.isBlackout || this.session?.isWhiteout) {
        this.session.clearBlank();
        return;
      }
      const rect = this.contentEl.getBoundingClientRect();
      if (e.clientX - rect.left > rect.width * 0.4) this.session?.next();
      else this.session?.prev();
    });
  }

  private setupTouchNavigation(): void {
    const el = this.contentEl;
    const inHud = (e: Event) => !!(e.target as HTMLElement)?.closest(".marp-presentation-hud");

    this.listen(el, "touchstart", (e: TouchEvent) => {
      if (inHud(e)) return;
      this.showHudTemporarily();
      const touch = e.touches[0];
      if (touch) {
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
      }
    });

    // Block scrolling while a horizontal swipe is in progress.
    this.listen(
      el,
      "touchmove",
      (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - this.touchStartX;
        const dy = touch.clientY - this.touchStartY;
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { passive: false },
    );

    const onTouchEnd = (e: TouchEvent) => {
      if (inHud(e)) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 100) {
        this.lastTouchSwipeTime = Date.now();
        if (dx < 0) this.session?.next();
        else this.session?.prev();
      }
    };
    this.listen(el, "touchend", onTouchEnd);
    this.listen(el, "touchcancel", onTouchEnd);
  }

  private setupAutoScaling(): void {
    const applyScale = () => {
      const w = this.contentEl.clientWidth || window.innerWidth;
      const h = this.contentEl.clientHeight || window.innerHeight;
      if (w > 0 && h > 0) {
        this.slideWrapperEl.style.transform = `translate(-50%, -50%) scale(${Math.min(w / SLIDE_W, h / SLIDE_H)})`;
      }
    };

    const observer = new ResizeObserver(() => requestAnimationFrame(applyScale));
    observer.observe(this.contentEl);
    this.unsubs.push(() => observer.disconnect());
    applyScale();
  }

  private cleanup(): void {
    clearTimeout(this.hudHideTimeout);
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.session?.release();
    this.session = null;
  }
}
