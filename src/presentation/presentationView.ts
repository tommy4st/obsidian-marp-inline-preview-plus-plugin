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
  loadSlideDeck,
  safePaintFrame,
} from "./types";
import { openPresenterView, hasMultipleScreens, observeScreenChanges } from "./service";

export async function setMobileStatusBar(visible: boolean): Promise<void> {
  try {
    const win = (typeof window !== "undefined" ? window : globalThis) as any;
    const cap = win?.Capacitor;
    const statusBar = cap?.Plugins?.StatusBar ?? win?.StatusBar;
    if (statusBar) {
      if (visible) {
        if (typeof statusBar.show === "function") await statusBar.show();
        if (typeof statusBar.setOverlaysWebView === "function") await statusBar.setOverlaysWebView({ overlay: false });
      } else {
        if (typeof statusBar.hide === "function") await statusBar.hide();
        if (typeof statusBar.setOverlaysWebView === "function") await statusBar.setOverlaysWebView({ overlay: true });
      }
    }
  } catch (err) {
    console.debug(`[marp-presentation] setMobileStatusBar(${visible}) error:`, err);
  }
}

export const hideMobileStatusBar = () => setMobileStatusBar(false);
export const showMobileStatusBar = () => setMobileStatusBar(true);

export class MarpPresentationView extends ItemView {
  public file: TFile | null = null;
  public session: PresentationSession | null = null;
  private deck: SlideDeckData | null = null;

  private stageEl!: HTMLElement;
  private slideWrapperEl!: HTMLElement;
  private iframe!: HTMLIFrameElement;
  private blankOverlayEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private hudCounterEl!: HTMLElement;
  private presenterBtn: HTMLElement | null = null;
  private hudHideTimeout: any = null;

  private unsubs: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private lastTouchSwipeTime = 0;

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
    contentEl.addClass("marp-presentation-view");
    contentEl.tabIndex = 0;

    // Slide Stage & Wrapper
    this.stageEl = contentEl.createDiv({ cls: "marp-presentation-stage" });
    this.slideWrapperEl = this.stageEl.createDiv({ cls: "marp-presentation-slide-wrapper" });
    this.slideWrapperEl.style.width = `${SLIDE_W}px`;
    this.slideWrapperEl.style.height = `${SLIDE_H}px`;

    this.iframe = createSlideIframe();
    this.slideWrapperEl.appendChild(this.iframe);

    // Overlays
    this.blankOverlayEl = contentEl.createDiv({ cls: "marp-presentation-blank-overlay" });

    // Controls & Listeners
    this.buildHud(contentEl);
    this.setupKeyboardNavigation(contentEl);
    this.setupClickNavigation(contentEl);
    this.setupTouchNavigation(contentEl);
    this.setupAutoScaling(contentEl);

    if (this.deck) {
      this.renderCurrentSlide();
      this.updateHud();
    }

    const fileModifyRef = this.app.vault.on("modify", async (modifiedFile) => {
      if (this.file && modifiedFile.path === this.file.path) {
        await this.reloadDeck();
      }
    });
    this.registerEvent(fileModifyRef);

    const onFocusOrClick = () => {
      const doc = contentEl.ownerDocument || document;
      if (!doc.fullscreenElement) {
        void this.enterFullscreen();
      }
    };

    if (Platform.isDesktop && this.isPopout()) {
      void this.enterFullscreen();
      const win = contentEl.ownerDocument?.defaultView || window;
      win.addEventListener("focus", onFocusOrClick);
      this.unsubs.push(() => win.removeEventListener("focus", onFocusOrClick));
    } else {
      void this.enterFullscreen();
    }

    contentEl.addEventListener("pointerdown", onFocusOrClick);
    this.unsubs.push(() => contentEl.removeEventListener("pointerdown", onFocusOrClick));

    const focusView = () => {
      try {
        const doc = contentEl.ownerDocument || document;
        doc.defaultView?.focus();
        contentEl.focus();
      } catch {}
    };
    focusView();
    setTimeout(focusView, 50);
    setTimeout(focusView, 150);
  }

  async onClose(): Promise<void> {
    void this.exitFullscreen();
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

      this.renderCurrentSlide();
      this.updateHud();
    } catch (err) {
      console.error("[marp-presentation] failed to render slide deck", err);
    }
  }

  private attachSessionListeners(session = this.session): void {
    if (!session) return;
    this.session = session;

    this.unsubs.push(
      session.on("slide-change", () => {
        this.renderCurrentSlide();
        this.updateHud();
      }),
      session.on("blank-change", (blank) => this.updateBlankOverlay(blank)),
      session.on("destroy", () => {
        this.session = null;
      }),
    );
  }

  private renderCurrentSlide(): void {
    if (!this.deck || !this.session) return;
    const slideHtml =
      this.deck.slides[this.session.currentSlide] ??
      "<div class=\"marp-inline-preview\"><section><h1>End of Deck</h1></section></div>";
    safePaintFrame(this.iframe, slideHtml, this.deck.css);
  }

  private updateBlankOverlay(blank: "none" | "black" | "white"): void {
    this.blankOverlayEl.toggleClass("is-blackout", blank === "black");
    this.blankOverlayEl.toggleClass("is-whiteout", blank === "white");
  }

  private buildHud(container: HTMLElement): void {
    this.hudEl = container.createDiv({ cls: "marp-presentation-hud" });
    this.hudCounterEl = this.hudEl.createDiv({
      cls: "marp-presentation-hud-counter",
      text: "Slide 1 / 1",
    });

    createIconButton(this.hudEl, "marp-presentation-hud-btn", "chevron-left", "Previous Slide (Left Arrow)", (e) => {
      e.stopPropagation();
      this.session?.prev();
    });

    createIconButton(this.hudEl, "marp-presentation-hud-btn", "chevron-right", "Next Slide (Right Arrow / Space)", (e) => {
      e.stopPropagation();
      this.session?.next();
    });

    this.presenterBtn = createIconButton(this.hudEl, "marp-presentation-hud-btn", "presentation", "Open Presenter View (P)", (e) => {
      e.stopPropagation();
      if (this.file) {
        void openPresenterView(this.app, this.plugin, this.file, {
          slideIndex: this.session?.currentSlide ?? 0,
        });
      }
    });
    this.updatePresenterButtonVisibility();
    this.unsubs.push(
      observeScreenChanges(
        () => this.updatePresenterButtonVisibility(),
        container.ownerDocument?.defaultView || window,
      ),
    );

    createIconButton(this.hudEl, "marp-presentation-hud-btn", "maximize", "Toggle Fullscreen (F)", (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });

    createIconButton(this.hudEl, "marp-presentation-hud-btn", "x", "Exit Presentation (Esc)", (e) => {
      e.stopPropagation();
      void this.exitPresentation();
    });

    const onMouseMove = () => {
      this.showHudTemporarily();
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e?.pointerType !== "touch") {
        this.hudEl?.removeClass("is-visible");
        this.contentEl.addClass("is-cursor-hidden");
      }
    };
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("pointerleave", onPointerLeave);
    this.unsubs.push(() => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("pointerleave", onPointerLeave);
    });
    this.showHudTemporarily();
  }

  public updatePresenterButtonVisibility(): void {
    if (!this.presenterBtn) return;
    this.presenterBtn.style.display = hasMultipleScreens(this.contentEl?.ownerDocument?.defaultView || window) ? "" : "none";
  }

  private showHudTemporarily(): void {
    if (!this.hudEl) return;
    this.updatePresenterButtonVisibility();
    this.hudEl.addClass("is-visible");
    this.contentEl.removeClass("is-cursor-hidden");
    if (this.hudHideTimeout) clearTimeout(this.hudHideTimeout);
    this.hudHideTimeout = setTimeout(() => {
      try {
        if (this.hudEl?.matches(":hover")) {
          this.showHudTemporarily();
          return;
        }
      } catch {}
      this.hudEl.removeClass("is-visible");
      this.contentEl.addClass("is-cursor-hidden");
    }, 2500);
  }

  private hideHud(): void {
    if (this.hudHideTimeout) clearTimeout(this.hudHideTimeout);
    this.hudEl?.removeClass("is-visible");
  }

  private updateHud(): void {
    if (!this.hudCounterEl || !this.session) return;
    this.hudCounterEl.textContent = `Slide ${this.session.currentSlide + 1} / ${this.session.totalSlides}`;
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

      switch (e.key) {
        case "p":
        case "P":
          e.preventDefault();
          if (this.file && hasMultipleScreens(this.contentEl?.ownerDocument?.defaultView || window)) {
            void openPresenterView(this.app, this.plugin, this.file, {
              slideIndex: this.session?.currentSlide ?? 0,
            });
          }
          break;
        case "f":
        case "F":
          e.preventDefault();
          this.toggleFullscreen();
          break;
        case "Escape":
          e.preventDefault();
          void this.exitPresentation();
          break;
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

    doc.addEventListener("keydown", onKey);
    container.addEventListener("keydown", onKey);

    this.unsubs.push(() => {
      doc.removeEventListener("keydown", onKey);
      container.removeEventListener("keydown", onKey);
    });
  }

  private setupClickNavigation(container: HTMLElement): void {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest(".marp-presentation-hud")) return;
      if (Date.now() - this.lastTouchSwipeTime < 350) return;
      if (this.session?.isBlackout || this.session?.isWhiteout) {
        this.session.clearBlank();
        return;
      }

      const rect = container.getBoundingClientRect();
      if (e.clientX - rect.left > rect.width * 0.4) {
        this.session?.next();
      } else {
        this.session?.prev();
      }
    };

    container.addEventListener("click", handleClick);
    this.unsubs.push(() => container.removeEventListener("click", handleClick));
  }

  private setupTouchNavigation(container: HTMLElement): void {
    const onTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest(".marp-presentation-hud")) return;
      this.showHudTemporarily();
      const doc = container.ownerDocument || document;
      if (!doc.fullscreenElement) {
        void this.enterFullscreen();
      }
      if (e.touches.length > 0) {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const dx = e.touches[0].clientX - this.touchStartX;
        const dy = e.touches[0].clientY - this.touchStartY;
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest(".marp-presentation-hud")) return;
      if (e.changedTouches.length === 0) return;
      const dx = e.changedTouches[0].clientX - this.touchStartX;
      const dy = e.changedTouches[0].clientY - this.touchStartY;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 100) {
        this.lastTouchSwipeTime = Date.now();
        if (dx < 0) this.session?.next();
        else this.session?.prev();
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    this.unsubs.push(() => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    });
  }

  private setupAutoScaling(container: HTMLElement): void {
    const applyScale = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      if (w > 0 && h > 0) {
        this.slideWrapperEl.style.transform = `translate(-50%, -50%) scale(${Math.min(w / SLIDE_W, h / SLIDE_H)})`;
      }
    };

    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(applyScale));
    this.resizeObserver.observe(container);
    applyScale();
  }

  public isPopout(): boolean {
    const doc = this.containerEl.ownerDocument;
    return doc !== undefined && doc !== document;
  }

  public async enterFullscreen(retries = Platform.isDesktop ? 6 : 0): Promise<boolean> {
    try {
      await hideMobileStatusBar();
      const doc = this.containerEl.ownerDocument || document;
      if (doc.fullscreenElement) return true;
      const target = (Platform.isDesktop ? this.containerEl : (doc.documentElement || this.containerEl)) as HTMLElement;
      if (typeof target?.requestFullscreen === "function") {
        await target.requestFullscreen({ navigationUI: "hide" } as any);
        return true;
      }
      if (typeof this.containerEl?.requestFullscreen === "function") {
        await this.containerEl.requestFullscreen();
        return true;
      }
    } catch {
      if (retries > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.enterFullscreen(retries - 1);
      }
      return false;
    }
    return false;
  }

  public async exitFullscreen(): Promise<void> {
    try {
      await showMobileStatusBar();
      const doc = this.containerEl.ownerDocument || document;
      if (doc.fullscreenElement) {
        await doc.exitFullscreen();
      }
    } catch {}
  }

  public async exitPresentation(): Promise<void> {
    await this.exitFullscreen();
    this.leaf.detach();
  }

  private toggleFullscreen(): void {
    const doc = this.containerEl.ownerDocument || document;
    if (!doc.fullscreenElement) {
      void this.enterFullscreen();
    } else {
      void this.exitFullscreen();
    }
  }

  private cleanup(): void {
    if (this.hudHideTimeout) clearTimeout(this.hudHideTimeout);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.session?.release();
    this.session = null;
  }
}
