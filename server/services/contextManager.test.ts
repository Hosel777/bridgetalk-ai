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
