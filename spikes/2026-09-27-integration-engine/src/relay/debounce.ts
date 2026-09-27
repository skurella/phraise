// New for this spike (brief 04, src/relay/). Plan section 6: "draft
// flusher: per branch, trailing debounce plus a maximum interval (defaults
// 2s and 60s; tests shorter), and on demand via POST /flush."
export class TrailingDebounce {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly debounceMs: number,
    private readonly maxIntervalMs: number,
    private readonly run: () => Promise<void>,
  ) {}

  /** Call on every change worth eventually flushing. Resets the trailing timer; the max-interval timer is armed once and left alone until it fires. */
  touch(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), this.debounceMs);
    if (this.timer.unref) this.timer.unref();
    if (!this.maxTimer) {
      this.maxTimer = setTimeout(() => this.fire(), this.maxIntervalMs);
      if (this.maxTimer.unref) this.maxTimer.unref();
    }
  }

  private fire(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    this.inFlight = this.run().catch((err) => {
      console.error('[relay] debounced flush failed', err);
    });
  }

  /** Runs `run()` now (cancelling any pending timers), awaiting any flush already in flight first. On demand: `POST /flush`. */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.inFlight) await this.inFlight;
    this.inFlight = this.run();
    await this.inFlight;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
  }
}
