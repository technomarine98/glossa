import type { TranslationResult } from "../providers/types";

interface CacheEntry {
  result: TranslationResult;
  expiresAt: number;
}

export class TranslationCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries = 250,
    private readonly ttlMs = 24 * 60 * 60 * 1000,
  ) {}

  get(key: string): TranslationResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, result: TranslationResult): void {
    this.entries.delete(key);
    this.entries.set(key, { result, expiresAt: Date.now() + this.ttlMs });
    const oldestKey = this.entries.keys().next().value as string | undefined;
    if (this.entries.size > this.maxEntries && oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }
}
