/**
 * Simple mutex implementation for preventing race conditions
 */

export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}

export class Debouncer {
  private timeouts = new Map<Function, NodeJS.Timeout>();

  debounce<T extends (...args: any[]) => Promise<void>>(
    fn: T,
    delay: number,
  ): (...args: Parameters<T>) => void {
    return (...args: Parameters<T>) => {
      const timeout = this.timeouts.get(fn);
      if (timeout) clearTimeout(timeout);

      this.timeouts.set(
        fn,
        setTimeout(async () => {
          await fn(...args);
          this.timeouts.delete(fn);
        }, delay),
      );
    };
  }
}

