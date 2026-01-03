import fs from "node:fs/promises";

import type { Event } from "../protocol/event.js";

export class EventLogWriter {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async append(event: Event): Promise<void> {
    const line = JSON.stringify({ ts: Date.now(), ...event }) + "\n";
    await fs.appendFile(this.path, line, "utf8");
  }
}

