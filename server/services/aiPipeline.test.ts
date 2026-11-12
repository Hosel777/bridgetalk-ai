import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiPipeline } from './aiPipeline.js';

test('uses an empty, explicit sandbox transcript when Deepgram is not configured', async () => {
  let fetchCount = 0;
  const pipeline = createAiPipeline({
    env: {},
    fetcher: async () => {
      fetchCount += 1;
      return new Response('{}');
    },
  });

  const result = await pipeline.transcribeAudio(
    Buffer.from([0, 1, 2]),
    'audio/webm',
  );

  assert.deepEqual(result, { text: '', status: 'sandbox' });
  assert.equal(fetchCount, 0);
});

test('sends binary audio to Deepgram and extracts the transcript', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const pipeline = createAiPipeline({
    env: { DEEPGRAM_API_KEY: 'test-deepgram-key' },
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({
          results: {
            channels: [
              {
                alternatives: [{ transcript: 'Diseñé servicios de baja latencia.' }],
              },
            ],
          },
        }),
      );
    },
  });

  const result = await pipeline.transcribeAudio(
    Buffer.from([1, 2, 3]),
    'audio/webm;codecs=opus',
    'es',
  );

  assert.equal(result.text, 'Diseñé servicios de baja latencia.');
  assert.equal(result.status, 'ok');
  assert.match(requestUrl, /language=es/);
  assert.equal(
    new Headers(requestInit?.headers).get('authorization'),
    'Token test-deepgram-key',
  );
  assert.equal(new Headers(requestInit?.headers).get('content-type'), 'audio/webm');
});

test('uses interview context in OpenAI instructions and reads generated text', async () => {
  let requestBody: Record<string, unknown> | null = null;
  const pipeline = createAiPipeline({
    env: { OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'test-model' },
    fetcher: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output: [
            { type: 'reasoning', id: 'ignored' },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'I led a platform migration.' }],
            },
          ],
        }),
      );
    },
  });

  const translated = await pipeline.translateWithContext(
    'Lideré una migración de plataforma.',
    'es',
    'en',
    {
      candidateCv: 'Led three production migrations.',
      jobDescription: 'Own cloud platform reliability.',
    },
  );

  assert.equal(translated, 'I led a platform migration.');
  assert.ok(requestBody);
  assert.equal(requestBody.model, 'test-model');
  assert.match(String(requestBody.instructions), /technical interview/i);
  assert.match(String(requestBody.input), /production migrations/);
  assert.match(String(requestBody.input), /cloud platform reliability/);
});

test('synthesizes Cartesia audio as a binary response', async () => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> | null = null;
  const pipeline = createAiPipeline({
    env: {
      CARTESIA_API_KEY: 'test-cartesia-key',
      CARTESIA_VOICE_ID: 'voice-id',
    },
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { 'content-type': 'audio/wav' },
      });
    },
  });

  const audio = await pipeline.synthesizeSpeech('Hello, recruiter.', 'en');

  assert.deepEqual(audio, Buffer.from([1, 2, 3]));
  assert.equal(requestUrl, 'https://api.cartesia.ai/tts/bytes');
  assert.equal(requestBody?.language, 'en');
  assert.equal(requestBody?.transcript, 'Hello, recruiter.');
});
