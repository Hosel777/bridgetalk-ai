import { getBackendUrl } from './backendUrl.js';

export interface LearningVocabularyGap {
  id: string;
  originalSpanish: string;
  nativeEnglish: string;
  technicalTerm: string;
  category: string;
}

export interface LearningSummary {
  sessionId: string;
  independenceScore: number;
  directEnglishInterventions: number;
  translatedInterventions: number;
  vocabularyGaps: LearningVocabularyGap[];
  studyPlan: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVocabularyGap(value: unknown): value is LearningVocabularyGap {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.originalSpanish === 'string' &&
    typeof value.nativeEnglish === 'string' &&
    typeof value.technicalTerm === 'string' &&
    typeof value.category === 'string'
  );
}

function isLearningSummary(value: unknown): value is LearningSummary {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.independenceScore === 'number' &&
    Number.isInteger(value.independenceScore) &&
    value.independenceScore >= 0 &&
    value.independenceScore <= 100 &&
    typeof value.directEnglishInterventions === 'number' &&
    Number.isInteger(value.directEnglishInterventions) &&
    value.directEnglishInterventions >= 0 &&
    typeof value.translatedInterventions === 'number' &&
    Number.isInteger(value.translatedInterventions) &&
    value.translatedInterventions >= 0 &&
    Array.isArray(value.vocabularyGaps) &&
    value.vocabularyGaps.every(isVocabularyGap) &&
    Array.isArray(value.studyPlan) &&
    value.studyPlan.every((step) => typeof step === 'string')
  );
}

function getErrorMessage(value: unknown): string | null {
  if (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.message === 'string'
  ) {
    return value.error.message;
  }
  return null;
}

export async function fetchLearningSummary(
  sessionId: string,
  accessToken?: string | null,
): Promise<LearningSummary> {
  const response = await fetch(
    getBackendUrl(
      `/api/learning-summary?sessionId=${encodeURIComponent(sessionId)}`,
    ),
    {
      ...(accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {}),
    },
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('El servidor devolvió un resumen de aprendizaje inválido.');
  }

  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload) ?? 'No se pudo sincronizar el resumen de aprendizaje.',
    );
  }
  if (!isLearningSummary(payload) || payload.sessionId !== sessionId) {
    throw new Error('El servidor devolvió un resumen de otra sesión o inválido.');
  }

  return payload;
}
