import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';
import {
  createAiPipeline,
  type DeepgramTranscriptionEvent,
} from './aiPipeline.js';

class FakeProviderSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  readonly audioChunks: Buffer[] = [];

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.emit('open');
    });
  }

  send(data: string | Buffer, callback?: (error?: Error) => void): void {
    if (typeof data === 'string') {
      const control = JSON.parse(data) as { type?: string };
      if (control.type === 'CloseStream') {
        this.close();
      }
      callback?.();
      return;
    }

    this.audioChunks.push(Buffer.from(data));
    const isFinal = this.audioChunks.length === 2;
    this.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'Results',
          is_final: isFinal,
          channel: {
            alternatives: [
              {
                transcript: isFinal
                  ? 'Diseñé una arquitectura escalable.'
                  : 'Diseñé una arquitectura',
              },
            ],
          },
        }),
      ),
      false,
    );
    callback?.();
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSED;
    this.emit('close', 1000, Buffer.alloc(0));
  }

  terminate(): void {
    this.close();
  }
}

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

test('streams Deepgram partial and final transcripts over one persistent session', {
  timeout: 5_000,
}, async () => {
  let requestedUrl = '';
  let authorization = '';
  let providerSocket: FakeProviderSocket | null = null;
  const pipeline = createAiPipeline({
    env: { DEEPGRAM_API_KEY: 'test-deepgram-key' },
    webSocketFactory: (url, socketOptions) => {
      requestedUrl = url;
      authorization = String(socketOptions.headers?.Authorization ?? '');
      providerSocket = new FakeProviderSocket();
      return providerSocket;
    },
  });
  const events: DeepgramTranscriptionEvent[] = [];
  let resolveEvents: (receivedEvents: DeepgramTranscriptionEvent[]) => void =
    () => undefined;
  const receivedEvents = new Promise<DeepgramTranscriptionEvent[]>((resolve) => {
    resolveEvents = resolve;
  });
  const openStream = pipeline.openTranscriptionStream;
  assert.ok(openStream);

  let stream: Awaited<ReturnType<typeof openStream>> | null = null;
  try {
    stream = await openStream({
      audioMimeType: 'audio/webm;codecs=opus',
      sourceLanguage: 'es',
      onEvent: (event) => {
        events.push(event);
        if (events.length === 2) {
          resolveEvents([...events]);
        }
      },
    });
    assert.ok(stream);

    stream.sendAudio(Buffer.from([1, 2, 3]));
    stream.sendAudio(Buffer.from([4, 5, 6]));
    const transcriptionEvents = await receivedEvents;

    assert.equal(new URL(requestedUrl).protocol, 'wss:');
    assert.equal(new URL(requestedUrl).pathname, '/v1/listen');
    assert.equal(new URL(requestedUrl).searchParams.get('interim_results'), 'true');
    assert.equal(authorization, 'Token test-deepgram-key');
    assert.deepEqual(providerSocket?.audioChunks, [
      Buffer.from([1, 2, 3]),
      Buffer.from([4, 5, 6]),
    ]);
    assert.deepEqual(
      transcriptionEvents.map((event) => event.type),
      ['partial', 'final'],
    );
    assert.deepEqual(
      transcriptionEvents.map((event) =>
        event.type === 'error' ? event.error.message : event.text,
      ),
      ['Diseñé una arquitectura', 'Diseñé una arquitectura escalable.'],
    );
  } finally {
    await stream?.close();
  }
});

test('does not open a Deepgram stream when the API key is missing', async () => {
  let connectionAttempts = 0;
  const pipeline = createAiPipeline({
    env: {},
    webSocketFactory: () => {
      connectionAttempts += 1;
      throw new Error('The streaming socket should not be created.');
    },
  });
  const openStream = pipeline.openTranscriptionStream;
  assert.ok(openStream);

  const stream = await openStream({
    audioMimeType: 'audio/webm',
    sourceLanguage: 'es',
    onEvent: () => undefined,
  });

  assert.equal(stream, null);
  assert.equal(connectionAttempts, 0);
});
