/**
 * Simple mutex implementation for preventing race conditions
 */

import { debugLog } from "./logger.js";

export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!;
      resolve();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Rate limiter to prevent rapid successive calls
 */
export class RateLimiter {
  private lastCall: number = 0;
  private minInterval: number;

  constructor(minIntervalMs: number = 1000) {
    this.minInterval = minIntervalMs;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;

    if (timeSinceLastCall < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastCall;
      debugLog(`Rate limiting: waiting ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastCall = Date.now();
  }
}

/**
 * Debouncer to prevent rapid repeated calls
 */
export class Debouncer {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastCallTime: number = 0;

  debounce<T extends (...args: any[]) => any>(
    fn: T,
    delayMs: number = 500,
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return new Promise((resolve, reject) => {
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
        }

        this.timeoutId = setTimeout(async () => {
          try {
            const result = await fn(...args);
            this.lastCallTime = Date.now();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, delayMs);
      });
    };
  }

  getLastCallTime(): number {
    return this.lastCallTime;
  }
}
