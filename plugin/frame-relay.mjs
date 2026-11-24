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
      after = 0;
      for (const [oldKey, old] of this.streams) {
        if (oldKey.startsWith(`${id}:${kind}:`)) {
          old.abort.abort();
          this.streams.delete(oldKey);
        }
      }
      stream = {
        abort: new AbortController(),
        sequence: 0,
        received: 0,
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
    if (!stream.error && (!stream.frame || stream.sequence === after)) {
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
      if (this.streams.get(key) === stream) this.streams.delete(key);
      throw new Error(stream.error);
    }
    return {
      sequence: stream.sequence,
      received: stream.received,
      frame:
        stream.sequence !== after
          ? (stream.frame?.toString("base64") ?? null)
          : null,
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
      // Assemble the next frame separately so a poll during a partial read
      // always sees a complete image. Swap buffers only when publishing.
      let incoming = Buffer.alloc(0);
      let published = Buffer.alloc(0);
      const writableFrame = (length) => {
        const capacity = Math.ceil(length / 4096) * 4096;
        if (
          incoming.length < length ||
          incoming.length > Math.max(capacity * 4, 65536)
        )
          incoming = Buffer.allocUnsafeSlow(capacity);
        return incoming.subarray(0, length);
      };
      for await (const bytes of readMultipartFrames(
        response.body,
        writableFrame,
      )) {
        stream.received++;
        if (kind === "simulator" && stream.frame?.equals(bytes)) continue;
        stream.frame = bytes;
        [incoming, published] = [published, incoming];
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
