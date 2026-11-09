export type Language = "auto" | "en" | "ru";
export type TargetLanguage = Exclude<Language, "auto">;
export type ProviderId = "mymemory" | "libretranslate" | "google";
export type LanguageDirection = "auto" | "en-ru" | "ru-en";
export type ModifierKey = "Alt" | "Control" | "Meta" | "Shift";

export interface TranslationSettings {
  enabled: boolean;
  autoTranslate: boolean;
  provider: ProviderId;
  defaultDirection: LanguageDirection;
  translationDelay: number;
  requireModifier: boolean;
  modifierKey: ModifierKey;
  disabledSites: string[];
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  googleApiKey: string;
}

export interface TranslateMessage {
  type: "translate";
  requestId: string;
  text: string;
  source: Language;
  target: TargetLanguage;
}

export interface CancelMessage {
  type: "cancel";
  requestId: string;
}

export type BackgroundMessage = TranslateMessage | CancelMessage;

export interface TranslationSuccess {
  ok: true;
  requestId: string;
  result: {
    text: string;
    detectedLanguage?: string;
  };
  source: TargetLanguage;
  target: TargetLanguage;
  cached: boolean;
}

export interface TranslationFailure {
  ok: false;
  requestId: string;
  error: string;
  aborted?: boolean;
}

export type TranslationResponse = TranslationSuccess | TranslationFailure;
