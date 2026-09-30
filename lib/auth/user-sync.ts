type SyncState = "idle" | "syncing" | "synced" | "error";

const MAX_RETRIES = 6;
const BASE_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

/** One Clerk session's Convex bootstrap, independent of the page's lifetime. */
export class UserSync {
  private state: SyncState = "idle";
  private listeners = new Set<() => void>();
  private generation = 0;
  private attempts = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly sessionKey: string, private ensureUser: () => Promise<unknown>) {}

  getSnapshot = () => this.state;
  getServerSnapshot = (): SyncState => "idle";

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.run();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.cancel();
        if (this.state === "syncing") this.state = "idle";
      }
    };
  };

  retry = () => {
    if (!this.listeners.size || this.inFlight) return;
    this.cancel();
    this.attempts = 0;
    this.state = "idle";
    this.run();
  };

  private cancel() {
    this.generation++;
    this.inFlight = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(state: SyncState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private run() {
    if (!this.listeners.size || this.inFlight || this.state === "synced" || this.state === "error") return;
    const generation = ++this.generation;
    this.inFlight = true;
    this.publish("syncing");
    void this.ensureUser().then(() => {
      if (generation !== this.generation) return;
      this.inFlight = false;
      this.attempts = 0;
      this.publish("synced");
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.inFlight = false;
      if (++this.attempts > MAX_RETRIES) {
        console.error("[Auth] ensureUser sync failed; retry budget exhausted", this.sessionKey, error);
        this.publish("error");
        return;
      }
      const delay = Math.min(BASE_RETRY_MS * 2 ** (this.attempts - 1), MAX_RETRY_MS);
      console.error(`[Auth] ensureUser sync failed; retrying in ${delay}ms`, this.sessionKey, error);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.run();
      }, delay);
    });
  }
}
