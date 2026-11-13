import { randomUUID } from 'node:crypto';

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_HISTORY_ENTRIES = 500;
const MAX_VOCABULARY_GAPS = 100;
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

export interface VocabularyGap {
  id: string;
  originalSpanish: string;
  nativeEnglish: string;
  technicalTerm: string;
  category: string;
}

export interface LearningSummary {
  independenceScore: number;
  directEnglishInterventions: number;
  translatedInterventions: number;
  vocabularyGaps: VocabularyGap[];
  studyPlan: string[];
}

const TECHNICAL_CATEGORIES: Array<{
  category: string;
  pattern: RegExp;
}> = [
  {
    category: 'Seguridad',
    pattern: /\b(seguridad|autenticaci[oó]n|autorizaci[oó]n|cifrado|vulnerabilidad|security|authentication|authorization|encryption)\b/i,
  },
  {
    category: 'Datos e IA',
    pattern: /\b(inteligencia artificial|machine learning|aprendizaje autom[aá]tico|modelo de lenguaje|llm|datos|base de datos|sql|data|database)\b/i,
  },
  {
    category: 'Cloud y DevOps',
    pattern: /\b(cloud|nube|aws|azure|gcp|docker|kubernetes|ci\/cd|despliegue|infraestructura|deployment|infrastructure)\b/i,
  },
  {
    category: 'Backend',
    pattern: /\b(api|apis|backend|servidor|microservicio|microservicios|node\.js|express|server|microservice)\b/i,
  },
  {
    category: 'Frontend',
    pattern: /\b(frontend|react|typescript|javascript|interfaz|componente|componentes|user interface)\b/i,
  },
  {
    category: 'Arquitectura',
    pattern: /\b(arquitectura|sistema distribuido|escalabilidad|architecture|distributed system|scalability)\b/i,
  },
  {
    category: 'Rendimiento',
    pattern: /\b(latencia|rendimiento|tiempo de respuesta|performance|latency|response time)\b/i,
  },
];

function findTechnicalTerm(
  originalSpanish: string,
  nativeEnglish: string,
): { technicalTerm: string; category: string } | null {
  for (const { category, pattern } of TECHNICAL_CATEGORIES) {
    const match =
      originalSpanish.match(pattern) ?? nativeEnglish.match(pattern);
    if (match?.[0]) {
      return { technicalTerm: match[0], category };
    }
  }
  return null;
}

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

interface StoredSession {
  context: InterviewContext;
  history: TranslationRecord[];
  directEnglishInterventions: number;
  translatedInterventions: number;
  vocabularyGaps: VocabularyGap[];
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
      directEnglishInterventions: 0,
      translatedInterventions: 0,
      vocabularyGaps: [],
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

  recordIntervention(
    sessionId: string,
    sourceLanguage: SessionLanguage,
  ): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    if (sourceLanguage === 'en') {
      session.directEnglishInterventions += 1;
    } else {
      session.translatedInterventions += 1;
    }
    this.touch(session);
    return true;
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
    if (translation.sourceLanguage === 'es' && translation.targetLanguage === 'en') {
      const technicalMatch = findTechnicalTerm(
        translation.originalText,
        translation.translatedText,
      );
      if (technicalMatch && session.vocabularyGaps.length < MAX_VOCABULARY_GAPS) {
        const duplicate = session.vocabularyGaps.some(
          (gap) =>
            gap.originalSpanish === translation.originalText &&
            gap.nativeEnglish === translation.translatedText,
        );
        if (!duplicate) {
          session.vocabularyGaps.push({
            id: randomUUID(),
            originalSpanish: translation.originalText,
            nativeEnglish: translation.translatedText,
            ...technicalMatch,
          });
        }
      }
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

  getLearningSummary(sessionId: string): LearningSummary | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const totalInterventions =
      session.directEnglishInterventions + session.translatedInterventions;
    const independenceScore =
      totalInterventions === 0
        ? 0
        : Math.round(
            (session.directEnglishInterventions / totalInterventions) * 100,
          );
    const vocabularyGaps = session.vocabularyGaps.map((gap) => ({ ...gap }));

    this.touch(session);
    return {
      independenceScore,
      directEnglishInterventions: session.directEnglishInterventions,
      translatedInterventions: session.translatedInterventions,
      vocabularyGaps,
      studyPlan: vocabularyGaps.slice(0, 3).map(
        (gap) =>
          `Practica en voz alta “${gap.nativeEnglish}” y reutiliza “${gap.technicalTerm}” en una respuesta sobre ${gap.category}.`,
      ),
    };
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
