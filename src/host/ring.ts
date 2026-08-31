/** Bounded byte buffer for terminal replay; eviction is chunk-granular (never splits a chunk). */
export class RingBuffer {
  private chunks: string[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  push(s: string): void {
    if (!s) return;
    this.chunks.push(s);
    this.total += s.length;
    while (this.total > this.maxBytes && this.chunks.length > 1) {
      this.total -= this.chunks[0].length;
      this.chunks.shift();
    }
  }

  data(): string {
    return this.chunks.join('');
  }

  size(): number {
    return this.total;
  }
}
