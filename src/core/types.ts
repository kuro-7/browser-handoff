export type Platform = 'ios' | 'android' | 'desktop' | 'other';
export type ContextKind = 'in-app' | 'browser' | 'standalone';
export type InAppName =
  | 'x'
  | 'line'
  | 'instagram'
  | 'facebook'
  | 'threads'
  | 'tiktok'
  | 'telegram'
  | 'whatsapp'
  | 'linkedin'
  | 'other';

/** 移る先（ブラウザ／ホーム画面アプリ）と保存領域が同じか。 */
export type StorageRelation = 'separate' | 'shared' | 'unknown';

export interface BrowserContext {
  platform: Platform;
  kind: ContextKind;
  /** kind === 'in-app' のときだけ入る。 */
  app?: InAppName;
  storage: StorageRelation;
}

/** `escape`: アプリ内ブラウザ → ブラウザ。`home-screen`: ブラウザ → ホーム画面アプリ。 */
export type Purpose = 'escape' | 'home-screen';

export type TicketStatus = 'valid' | 'expired' | 'used' | 'not-transferable' | 'unknown';

export interface TicketLookup {
  status: TicketStatus;
  /** 照会で分かれば入る（`valid` でなくても）。 */
  subjectId?: string;
}
