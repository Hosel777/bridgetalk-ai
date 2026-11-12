import { randomUUID } from 'node:crypto';

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_HISTORY_ENTRIES = 500;
export const MAX_CONTEXT_CHARACTERS = 20_000;
export const MAX_TRANSLATION_CHARACTERS = 8_000;

export type SessionLanguage = 'es' | 'en';

export interface InterviewContext {
  candidateCv: string;
  jobDescription: string;
}

export interface TranslationRecord {
  sourceLanguage: SessionLanguage;
  targetLanguage: SessionLanguage;
  originalText: string;
  translatedText: string;
  timestamp: string;
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

interface StoredSession {
  context: InterviewContext;
  history: TranslationRecord[];
  expiresAt: number;
}

export class ContextManager {
  private readonly sessions = new Map<string, StoredSession>();

  createSession(sessionId = randomUUID()): string {
    if (!isValidSessionId(sessionId)) {
      throw new Error('Session ID must be a UUID.');
    }

    this.removeExpiredSessions();
    if (this.sessions.has(sessionId)) {
      return sessionId;
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error('The in-memory session limit has been reached.');
    }

    this.sessions.set(sessionId, {
      context: { candidateCv: '', jobDescription: '' },
      history: [],
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return sessionId;
  }

  ensureSession(sessionId: string): boolean {
    if (!isValidSessionId(sessionId)) {
      return false;
    }

    try {
      this.createSession(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  hasSession(sessionId: string): boolean {
    return this.getSession(sessionId) !== null;
  }

  saveContext(sessionId: string, context: InterviewContext): boolean {
    const session = this.getSession(sessionId);
    if (
      !session ||
      context.candidateCv.length > MAX_CONTEXT_CHARACTERS ||
      context.jobDescription.length > MAX_CONTEXT_CHARACTERS
    ) {
      return false;
    }

    session.context = {
      candidateCv: context.candidateCv,
      jobDescription: context.jobDescription,
    };
    this.touch(session);
    return true;
  }

  getContext(sessionId: string): InterviewContext | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    this.touch(session);
    return { ...session.context };
  }

  recordTranslation(
    sessionId: string,
    translation: Omit<TranslationRecord, 'timestamp'> & { timestamp?: string },
  ): boolean {
    const session = this.getSession(sessionId);
    if (
      !session ||
      translation.originalText.length > MAX_TRANSLATION_CHARACTERS ||
      translation.translatedText.length > MAX_TRANSLATION_CHARACTERS
    ) {
      return false;
    }

    session.history.push({
      ...translation,
      timestamp: translation.timestamp ?? new Date().toISOString(),
    });
    if (session.history.length > MAX_HISTORY_ENTRIES) {
      session.history.splice(0, session.history.length - MAX_HISTORY_ENTRIES);
    }
    this.touch(session);
    return true;
  }

  getHistory(sessionId: string): TranslationRecord[] {
    const session = this.getSession(sessionId);
    if (!session) {
      return [];
    }

    this.touch(session);
    return session.history.map((entry) => ({ ...entry }));
  }

  private getSession(sessionId: string): StoredSession | null {
    if (!isValidSessionId(sessionId)) {
      return null;
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  private touch(session: StoredSession): void {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
  }

  private removeExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
