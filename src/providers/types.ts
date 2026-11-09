import type { Language, TargetLanguage } from "../shared/types";

export interface TranslationResult {
  text: string;
  detectedLanguage?: string;
}

export interface TranslationProvider {
  readonly id: string;

  translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
