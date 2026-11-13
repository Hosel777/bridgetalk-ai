import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ContextManager } from './services/contextManager.js';
import type { AiPipeline } from './services/aiPipeline.js';
import { createBridgeTalkServer } from './index.js';

const contextManager = new ContextManager();
const pipeline: AiPipeline = {
  transcribeAudio: async () => ({
    text: 'Diseñé un servicio de baja latencia.',
    status: 'ok',
  }),
  translateWithContext: async (_text, _source, _target, context) =>
    `I designed a low-latency service for ${context.jobDescription}.`,
  synthesizeSpeech: async () => Buffer.from([4, 5, 6]),
  generateConfidenceSeal: async () => 'I bring reliable platform experience.',
};
const bridgeTalk = createBridgeTalkServer({
  allowedOrigins: new Set(['http://localhost:5173']),
  contextManager,
  pipeline,
});
let serverUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    bridgeTalk.server.listen(0, '127.0.0.1', resolve);
  });
  const address = bridgeTalk.server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    bridgeTalk.wss.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      bridgeTalk.server.close((serverError) => {
        if (serverError) {
          reject(serverError);
          return;
        }
        resolve();
      });
    });
  });
});

test('saves bounded CV and job context for a session', async () => {
  const sessionId = contextManager.createSession();
  const response = await fetch(`${serverUrl}/api/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      candidateCv: 'Senior TypeScript engineer.',
      jobDescription: 'Build realtime translation tools.',
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(contextManager.getContext(sessionId), {
    candidateCv: 'Senior TypeScript engineer.',
    jobDescription: 'Build realtime translation tools.',
  });
});

test('returns the session learning score, technical flashcards, and study plan', async () => {
  const sessionId = contextManager.createSession();
  contextManager.recordIntervention(sessionId, 'en');
  contextManager.recordIntervention(sessionId, 'es');
  contextManager.recordTranslation(sessionId, {
    sourceLanguage: 'es',
    targetLanguage: 'en',
    originalText: 'Diseñé una API escalable.',
    translatedText: 'I designed a scalable API.',
  });

  const response = await fetch(
    `${serverUrl}/api/learning-summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  const summary = await response.json();

  assert.equal(response.status, 200);
  assert.equal(summary.sessionId, sessionId);
  assert.equal(summary.independenceScore, 50);
  assert.equal(summary.directEnglishInterventions, 1);
  assert.equal(summary.translatedInterventions, 1);
  assert.equal(summary.vocabularyGaps.length, 1);
  assert.match(summary.studyPlan[0], /API/);
});

test('relays binary audio between legacy clients', async () => {
  const sender = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
    origin: 'http://localhost:5173',
  });
  const receiver = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
    origin: 'http://localhost:5173',
  });
  await Promise.all([once(sender, 'open'), once(receiver, 'open')]);

  const received = once(receiver, 'message');
  const audio = Buffer.from([8, 9, 10]);
  sender.send(audio);
  const [data, isBinary] = await received;

  assert.equal(isBinary, true);
  assert.deepEqual(data, audio);
  const closed = Promise.all([once(sender, 'close'), once(receiver, 'close')]);
  sender.close();
  receiver.close();
  await closed;
});

test('counts English-origin audio as an independent intervention', async () => {
  const sessionId = contextManager.createSession();
  const socket = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
    origin: 'http://localhost:5173',
  });
  await once(socket, 'open');

  const nextMessage = async (): Promise<Record<string, unknown>> => {
    const [data] = await once(socket, 'message');
    assert.ok(data instanceof Buffer);
    return JSON.parse(data.toString()) as Record<string, unknown>;
  };
  socket.send(
    JSON.stringify({
      type: 'session.start',
      sessionId,
      sourceLanguage: 'en',
      targetLanguage: 'es',
      audioMimeType: 'audio/webm',
    }),
  );
  assert.equal((await nextMessage()).type, 'session.started');
  socket.send(Buffer.from([1, 2, 3]));
  assert.equal((await nextMessage()).type, 'translation.result');

  const response = await fetch(
    `${serverUrl}/api/learning-summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  const summary = await response.json();
  assert.equal(summary.independenceScore, 100);

  const socketClosed = once(socket, 'close');
  socket.close();
  await socketClosed;
});

test('records translated Spanish audio in the learning summary', async () => {
  const sessionId = contextManager.createSession();
  const socket = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
    origin: 'http://localhost:5173',
  });
  await once(socket, 'open');

  const nextMessage = async (): Promise<Record<string, unknown>> => {
    const [data] = await once(socket, 'message');
    assert.ok(data instanceof Buffer);
    return JSON.parse(data.toString()) as Record<string, unknown>;
  };
  socket.send(
    JSON.stringify({
      type: 'session.start',
      sessionId,
      sourceLanguage: 'es',
      targetLanguage: 'en',
      audioMimeType: 'audio/webm',
    }),
  );
  assert.equal((await nextMessage()).type, 'session.started');
  socket.send(Buffer.from([1, 2, 3]));
  assert.equal((await nextMessage()).type, 'translation.result');

  const response = await fetch(
    `${serverUrl}/api/learning-summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  const summary = await response.json();
  assert.equal(summary.independenceScore, 0);
  assert.equal(summary.vocabularyGaps.length, 1);
  assert.match(summary.vocabularyGaps[0].category, /Rendimiento/);

  const socketClosed = once(socket, 'close');
  socket.close();
  await socketClosed;
});

test('processes audio and confidence requests through the session pipeline', async () => {
  const sessionId = contextManager.createSession();
  contextManager.saveContext(sessionId, {
    candidateCv: 'Senior TypeScript engineer.',
    jobDescription: 'Build realtime translation tools.',
  });

  const socket = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
    origin: 'http://localhost:5173',
  });
  await once(socket, 'open');
  const nextMessage = async (): Promise<Record<string, unknown>> => {
    const [data] = await once(socket, 'message');
    assert.ok(data instanceof Buffer);
    return JSON.parse(data.toString()) as Record<string, unknown>;
  };

  socket.send(
    JSON.stringify({
      type: 'session.start',
      sessionId,
      sourceLanguage: 'es',
      targetLanguage: 'en',
      audioMimeType: 'audio/webm;codecs=opus',
    }),
  );
  assert.equal((await nextMessage()).type, 'session.started');

  socket.send(Buffer.from([1, 2, 3]));
  const translation = await nextMessage();
  assert.equal(translation.type, 'translation.result');
  assert.equal(translation.originalText, 'Diseñé un servicio de baja latencia.');
  assert.equal(
    translation.translatedText,
    'I designed a low-latency service for Build realtime translation tools..',
  );
  assert.equal(translation.audioBase64, Buffer.from([4, 5, 6]).toString('base64'));
  assert.equal(translation.status, 'ok');
  assert.equal(contextManager.getHistory(sessionId).length, 1);

  socket.send(JSON.stringify({ type: 'confidence.seal' }));
  const confidence = await nextMessage();
  assert.equal(confidence.type, 'confidence.result');
  assert.equal(confidence.translatedText, 'I bring reliable platform experience.');

  const socketClosed = once(socket, 'close');
  socket.close();
  await socketClosed;
});
