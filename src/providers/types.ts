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

export class RateLimitError extends ProviderError {
  constructor(
    readonly provider: string,
    readonly retryAt: number,
    readonly dailyLimit = false,
  ) {
    const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    const wait = seconds < 60 ? `${seconds} seconds`
      : seconds < 3600 ? `${Math.ceil(seconds / 60)} minutes`
      : `${Math.ceil(seconds / 3600)} hours`;
    super(dailyLimit
      ? `${provider}'s daily translation limit is reached. Try again in ${wait}, or change provider in settings.`
      : `${provider} is limiting requests (429). Try again in ${wait}, or change provider in settings.`);
    this.name = "RateLimitError";
  }
}
