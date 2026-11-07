import { readMultipartFrames } from "../skills/scribble/scripts/lib/capture/frame-parser.mjs";

// Keep one live connection per canvas/source. UI tool calls take only the newest
// frame; slow hosts never build up a queue of stale screenshots.
export class FrameRelay {
  constructor(backend) {
    this.backend = backend;
    this.streams = new Map();
  }
  async next(id, token, kind, generation, after = 0) {
    await this.backend.authorize(id, token);
    const key = `${id}:${kind}:${generation}`;
    let stream = this.streams.get(key);
    if (!stream) {
      for (const [oldKey, old] of this.streams) {
        if (oldKey.startsWith(`${id}:${kind}:`)) {
          old.abort.abort();
          this.streams.delete(oldKey);
        }
      }
      stream = {
        abort: new AbortController(),
        sequence: 0,
        frame: null,
        error: null,
        touched: Date.now(),
        waiters: new Set(),
      };
      this.streams.set(key, stream);
      void this.consume(stream, key, id, token, kind, generation).catch(
        (error) => {
          stream.error = error.message;
          for (const wake of stream.waiters) wake();
          if (this.streams.get(key) === stream) this.streams.delete(key);
        },
      );
    }
    stream.touched = Date.now();
    if (stream.sequence <= after && !stream.error) {
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          stream.waiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        stream.waiters.add(finish);
      });
    }
    if (stream.error) {
      this.streams.delete(key);
      throw new Error(stream.error);
    }
    return {
      sequence: stream.sequence,
      frame: stream.sequence > after ? stream.frame : null,
    };
  }
  async consume(stream, key, id, token, kind, generation) {
    const timer = setInterval(() => {
      if (Date.now() - stream.touched > 10000) {
        stream.abort.abort();
        if (this.streams.get(key) === stream) this.streams.delete(key);
      }
    }, 5000);
    timer.unref();
    try {
      const { origin } = await this.backend.connection(id);
      const response = await fetch(
        `${origin}/api/capture/stream?kind=${kind}&generation=${generation}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Scribble-Session": id,
          },
          signal: stream.abort.signal,
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      for await (const bytes of readMultipartFrames(response.body)) {
        stream.frame = Buffer.from(bytes).toString("base64");
        stream.sequence++;
        for (const wake of stream.waiters) wake();
      }
      throw new Error("Live view disconnected. Choose Reconnect.");
    } finally {
      clearInterval(timer);
    }
  }
  close() {
    for (const stream of this.streams.values()) stream.abort.abort();
    this.streams.clear();
  }
}
