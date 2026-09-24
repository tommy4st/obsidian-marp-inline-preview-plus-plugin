import {
  PRESENTATION_CHANNEL_NAME,
  PresentationMessage,
  PresentationState,
  PresentationTimerState,
} from './types';

export class PresentationSession {
  private static instances = new Map<string, PresentationSession>();

  public filePath: string;
  public currentSlide = 0;
  public totalSlides = 0;
  public isBlackout = false;
  public isWhiteout = false;
  public timer: PresentationTimerState = {
    isRunning: false,
    elapsedSeconds: 0,
    startedAt: null,
  };

  private timerInterval: any = null;
  private channel: BroadcastChannel | null = null;
  private refCount = 0;
  private listeners = new Map<string, Set<Function>>();

  private constructor(filePath: string, totalSlides = 0) {
    this.filePath = filePath;
    this.totalSlides = Math.max(0, totalSlides);
    this.initChannel();
  }

  public static getOrCreate(filePath: string, totalSlides = 0): PresentationSession {
    let session = this.instances.get(filePath);
    if (!session) {
      session = new PresentationSession(filePath, totalSlides);
      this.instances.set(filePath, session);
    } else if (totalSlides > 0 && session.totalSlides !== totalSlides) {
      session.setTotalSlides(totalSlides);
    }
    session.refCount++;
    return session;
  }

  public static get(filePath: string): PresentationSession | undefined {
    return this.instances.get(filePath);
  }

  public release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.destroy();
    }
  }

  public setTotalSlides(total: number): void {
    this.totalSlides = Math.max(0, total);
    if (this.currentSlide >= this.totalSlides && this.totalSlides > 0) {
      this.currentSlide = this.totalSlides - 1;
    }
    this.emit('slide-change', this.currentSlide, this.totalSlides);
    this.emit('state-change', this.getState());
  }

  public getState(): PresentationState {
    return {
      filePath: this.filePath,
      currentSlide: this.currentSlide,
      totalSlides: this.totalSlides,
      isBlackout: this.isBlackout,
      isWhiteout: this.isWhiteout,
      timer: { ...this.timer },
    };
  }

  // --- Navigation Controls ---

  public next(): boolean {
    return this.currentSlide < this.totalSlides - 1 ? this.goTo(this.currentSlide + 1) : false;
  }

  public prev(): boolean {
    return this.currentSlide > 0 ? this.goTo(this.currentSlide - 1) : false;
  }

  public first(): boolean {
    return this.goTo(0);
  }

  public last(): boolean {
    return this.goTo(Math.max(0, this.totalSlides - 1));
  }

  public goTo(index: number, broadcast = true): boolean {
    const clamped = Math.max(0, Math.min(index, Math.max(0, this.totalSlides - 1)));
    if (clamped !== this.currentSlide || this.isBlackout || this.isWhiteout) {
      this.currentSlide = clamped;
      if (this.isBlackout || this.isWhiteout) {
        this.setBlank('none', false);
      }
      this.emit('slide-change', this.currentSlide, this.totalSlides);
      this.emit('state-change', this.getState());

      if (broadcast) {
        this.postMessage({
          type: 'NAVIGATE',
          filePath: this.filePath,
          slideIndex: this.currentSlide,
        });
      }
      return true;
    }
    return false;
  }

  // --- Blank Screen Controls ---

  public setBlank(blank: 'none' | 'black' | 'white', broadcast = true): void {
    const wasBlack = this.isBlackout;
    const wasWhite = this.isWhiteout;
    this.isBlackout = blank === 'black';
    this.isWhiteout = blank === 'white';
    if (this.isBlackout !== wasBlack || this.isWhiteout !== wasWhite) {
      this.emit('blank-change', blank);
      this.emit('state-change', this.getState());
      if (broadcast) {
        this.postMessage({ type: 'SET_BLANK', blank });
      }
    }
  }

  public toggleBlackout(broadcast = true): void {
    this.setBlank(this.isBlackout ? 'none' : 'black', broadcast);
  }

  public toggleWhiteout(broadcast = true): void {
    this.setBlank(this.isWhiteout ? 'none' : 'white', broadcast);
  }

  public clearBlank(broadcast = true): void {
    this.setBlank('none', broadcast);
  }

  // --- Timer Controls ---

  private notifyTimer(): void {
    this.emit('timer-tick', { ...this.timer });
    this.emit('state-change', this.getState());
  }

  public startTimer(broadcast = true): void {
    if (this.timer.isRunning) return;
    this.timer.isRunning = true;
    this.timer.startedAt = Date.now();
    this.startTimerInterval();
    this.notifyTimer();
    if (broadcast) this.postMessage({ type: 'TIMER_CONTROL', action: 'start' });
  }

  public pauseTimer(broadcast = true): void {
    if (!this.timer.isRunning) return;
    this.timer.isRunning = false;
    this.timer.startedAt = null;
    this.stopTimerInterval();
    this.notifyTimer();
    if (broadcast) this.postMessage({ type: 'TIMER_CONTROL', action: 'pause' });
  }

  public resetTimer(broadcast = true): void {
    this.timer.elapsedSeconds = 0;
    if (this.timer.isRunning) this.timer.startedAt = Date.now();
    this.notifyTimer();
    if (broadcast) this.postMessage({ type: 'TIMER_CONTROL', action: 'reset' });
  }

  private startTimerInterval(): void {
    this.stopTimerInterval();
    this.timerInterval = setInterval(() => {
      this.timer.elapsedSeconds++;
      this.emit('timer-tick', { ...this.timer });
    }, 1000);
  }

  private stopTimerInterval(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // --- Event Subscription & Broadcast ---

  public on(event: 'slide-change', cb: (index: number, total: number) => void): () => void;
  public on(event: 'timer-tick', cb: (timer: PresentationTimerState) => void): () => void;
  public on(event: 'blank-change', cb: (blank: 'none' | 'black' | 'white') => void): () => void;
  public on(event: 'state-change', cb: (state: PresentationState) => void): () => void;
  public on(event: 'destroy', cb: () => void): () => void;
  public on(event: string, cb: any): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of Array.from(callbacks)) {
        cb(...args);
      }
    }
  }

  private initChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(PRESENTATION_CHANNEL_NAME);
      this.channel.onmessage = (evt: MessageEvent<PresentationMessage>) => {
        this.handleMessage(evt.data);
      };
      this.postMessage({ type: 'SYNC_REQUEST' });
    } catch {
      this.channel = null;
    }
  }

  private postMessage(msg: PresentationMessage): void {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }
  }

  private handleMessage(msg: PresentationMessage): void {
    if (!msg) return;
    switch (msg.type) {
      case 'NAVIGATE':
        if (msg.filePath === this.filePath && msg.slideIndex !== this.currentSlide) {
          this.goTo(msg.slideIndex, false);
        }
        break;
      case 'SET_BLANK':
        this.setBlank(msg.blank, false);
        break;
      case 'TIMER_CONTROL':
        if (msg.action === 'start') this.startTimer(false);
        else if (msg.action === 'pause') this.pauseTimer(false);
        else if (msg.action === 'reset') this.resetTimer(false);
        break;
      case 'SYNC_REQUEST':
        this.postMessage({ type: 'SYNC_RESPONSE', state: this.getState() });
        break;
      case 'SYNC_RESPONSE':
        if (msg.state.filePath === this.filePath) {
          this.currentSlide = msg.state.currentSlide;
          this.setBlank(msg.state.isBlackout ? 'black' : msg.state.isWhiteout ? 'white' : 'none', false);
          this.timer = { ...msg.state.timer };
          if (this.timer.isRunning && !this.timerInterval) {
            this.startTimerInterval();
          } else if (!this.timer.isRunning && this.timerInterval) {
            this.stopTimerInterval();
          }
          this.emit('slide-change', this.currentSlide, this.totalSlides);
          this.emit('timer-tick', { ...this.timer });
        }
        break;
    }
  }

  public destroy(): void {
    this.stopTimerInterval();
    if (this.channel) {
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
    this.emit('destroy');
    this.listeners.clear();
    PresentationSession.instances.delete(this.filePath);
  }
}
