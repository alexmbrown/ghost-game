// Simulation clock that keeps running in background tabs.
//
// requestAnimationFrame stops when a tab is hidden, and main-thread timers get
// throttled to ~1 Hz. For an online host that would freeze the match for every
// player. Timers inside a Web Worker are not throttled that way, so a tiny
// worker posts a message every ~16 ms and we tick the session from it.

type Tick = (nowMs: number) => void;

const WORKER_SRC = `
let id = null;
onmessage = (e) => {
  if (e.data === 'start' && id === null) id = setInterval(() => postMessage(0), 1000 / 60);
  if (e.data === 'stop' && id !== null) { clearInterval(id); id = null; }
};
`;

export class Ticker {
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private url: string | null = null;

  constructor(private readonly onTick: Tick) {}

  start(): void {
    const fire = () => this.onTick(performance.now());
    try {
      this.url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.worker.onmessage = fire;
      this.worker.postMessage('start');
    } catch {
      // CSP or old browser: plain interval (throttled in background, but works).
      this.fallback = setInterval(fire, 1000 / 60);
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.worker.terminate();
      this.worker = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    if (this.fallback) {
      clearInterval(this.fallback);
      this.fallback = null;
    }
  }
}
