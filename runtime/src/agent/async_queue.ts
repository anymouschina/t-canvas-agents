export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  size(): number {
    return this.items.length;
  }

  isClosed(): boolean {
    return this.closed;
  }

  push(item: T): void {
    if (this.closed) {
      throw new Error("AsyncQueue is closed");
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  async shift(): Promise<T | undefined> {
    const existing = this.items.shift();
    if (existing !== undefined) {
      return existing;
    }
    if (this.closed) {
      return undefined;
    }
    return new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(undefined);
    }
  }
}
