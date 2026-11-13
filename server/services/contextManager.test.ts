import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContextManager } from './contextManager.js';

test('stores candidate context and translated history per session', () => {
  const contextManager = new ContextManager();
  const firstSessionId = contextManager.createSession(
    '56a7b280-2d88-40d0-a6c4-e637f87d09ad',
  );
  const secondSessionId = contextManager.createSession(
    '22d1e529-1406-4458-98e3-1d3f840db31a',
  );

  contextManager.saveContext(firstSessionId, {
    candidateCv: 'TypeScript engineer with API experience.',
    jobDescription: 'Build reliable real-time systems.',
  });
  contextManager.recordTranslation(firstSessionId, {
    sourceLanguage: 'es',
    targetLanguage: 'en',
    originalText: 'Diseñé una API en tiempo real.',
    translatedText: 'I designed a real-time API.',
  });

  assert.deepEqual(contextManager.getContext(firstSessionId), {
    candidateCv: 'TypeScript engineer with API experience.',
    jobDescription: 'Build reliable real-time systems.',
  });
  assert.equal(contextManager.getHistory(firstSessionId).length, 1);
  assert.equal(contextManager.getContext(secondSessionId)?.candidateCv, '');
  assert.equal(contextManager.getHistory(secondSessionId).length, 0);
});

test('rejects invalid session identifiers and unknown session writes', () => {
  const contextManager = new ContextManager();

  assert.throws(() => contextManager.createSession('not-a-uuid'));
  assert.equal(
    contextManager.saveContext('56a7b280-2d88-40d0-a6c4-e637f87d09ad', {
      candidateCv: '',
      jobDescription: '',
    }),
    false,
  );
});

test('calculates independence from direct English and translated interventions', () => {
  const contextManager = new ContextManager();
  const sessionId = contextManager.createSession();

  assert.equal(contextManager.getLearningSummary(sessionId)?.independenceScore, 0);
  contextManager.recordIntervention(sessionId, 'en');
  contextManager.recordIntervention(sessionId, 'es');
  contextManager.recordIntervention(sessionId, 'es');

  const summary = contextManager.getLearningSummary(sessionId);
  assert.equal(summary?.independenceScore, 33);
  assert.equal(summary?.directEnglishInterventions, 1);
  assert.equal(summary?.translatedInterventions, 2);
});

test('stores unique Spanish-to-English technical flashcards and study steps', () => {
  const contextManager = new ContextManager();
  const sessionId = contextManager.createSession();
  const phrase = 'Diseñé una API escalable en TypeScript.';
  const translation = 'I designed a scalable API in TypeScript.';

  const spanishToEnglish = {
    sourceLanguage: 'es' as const,
    targetLanguage: 'en' as const,
    originalText: phrase,
    translatedText: translation,
  };
  contextManager.recordTranslation(sessionId, spanishToEnglish);
  contextManager.recordTranslation(sessionId, spanishToEnglish);
  contextManager.recordTranslation(sessionId, {
    sourceLanguage: 'en',
    targetLanguage: 'es',
    originalText: translation,
    translatedText: phrase,
  });

  const summary = contextManager.getLearningSummary(sessionId);
  assert.ok(summary);
  assert.equal(summary.vocabularyGaps.length, 1);
  const gap = summary.vocabularyGaps[0];
  assert.ok(gap);
  assert.equal(typeof gap.id, 'string');
  assert.deepEqual(summary.vocabularyGaps[0], {
    id: gap.id,
    originalSpanish: phrase,
    nativeEnglish: translation,
    technicalTerm: 'API',
    category: 'Backend',
  });
  assert.match(summary.studyPlan[0] ?? '', /API/);
  assert.match(summary.studyPlan[0] ?? '', /scalable API/);
});
