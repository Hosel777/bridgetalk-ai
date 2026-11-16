import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { ContextManager } from './services/contextManager.js';
import {
  createSubscriptionService,
  type SubscriptionProfile,
  type SubscriptionService,
} from './services/subscriptionService.js';
import type {
  AiPipeline,
  DeepgramTranscriptionEvent,
} from './services/aiPipeline.js';
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

test('forwards interim Deepgram text and translates only final transcripts', {
  timeout: 5_000,
}, async () => {
  const streamingContextManager = new ContextManager();
  let emitDeepgramEvent:
    | ((event: DeepgramTranscriptionEvent) => void)
    | null = null;
  const streamedAudio: Buffer[] = [];
  let transcriptionRequests = 0;
  let translationRequests = 0;
  let resolveAudioForwarded: (() => void) | null = null;
  const streamingPipeline: AiPipeline = {
    openTranscriptionStream: async ({ onEvent }) => {
      emitDeepgramEvent = onEvent;
      return {
        sendAudio: (audio) => {
          streamedAudio.push(Buffer.from(audio));
          resolveAudioForwarded?.();
        },
        close: async () => undefined,
      };
    },
    transcribeAudio: async () => {
      transcriptionRequests += 1;
      return { text: '', status: 'sandbox' };
    },
    translateWithContext: async (text) => {
      translationRequests += 1;
      return `Translated: ${text}`;
    },
    synthesizeSpeech: async () => Buffer.from([1, 2, 3]),
    generateConfidenceSeal: async () => 'Introduction.',
  };
  const streamingServer = createBridgeTalkServer({
    allowedOrigins: new Set(['http://localhost:5173']),
    contextManager: streamingContextManager,
    pipeline: streamingPipeline,
  });
  let socket: WebSocket | null = null;

  try {
    await new Promise<void>((resolve) => {
      streamingServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = streamingServer.server.address();
    assert.ok(address && typeof address !== 'string');
    const socketUrl = `ws://127.0.0.1:${address.port}/audio`;
    const connectedSocket = new WebSocket(socketUrl, {
      origin: 'http://localhost:5173',
    });
    socket = connectedSocket;
    await once(connectedSocket, 'open');

    const nextMessage = async (): Promise<Record<string, unknown>> => {
      const [data] = await once(connectedSocket, 'message');
      assert.ok(data instanceof Buffer);
      return JSON.parse(data.toString()) as Record<string, unknown>;
    };

    const sessionId = streamingContextManager.createSession();
    const sessionStartedPromise = nextMessage();
    connectedSocket.send(
      JSON.stringify({
        type: 'session.start',
        sessionId,
        sourceLanguage: 'es',
        targetLanguage: 'en',
        audioMimeType: 'audio/webm',
      }),
    );
    assert.equal((await sessionStartedPromise).type, 'session.started');

    const audio = Buffer.from([9, 8, 7]);
    const audioForwarded = new Promise<void>((resolve) => {
      resolveAudioForwarded = resolve;
    });
    connectedSocket.send(audio);
    await audioForwarded;
    const partialMessagePromise = nextMessage();
    const emitPartial = emitDeepgramEvent;
    assert.ok(emitPartial);
    emitPartial({ type: 'partial', text: 'Estoy diseñando una API' });
    const partialMessage = await partialMessagePromise;
    assert.equal(partialMessage.type, 'transcription.partial');
    assert.equal(partialMessage.interimText, 'Estoy diseñando una API');
    assert.equal(translationRequests, 0);

    const finalMessagePromise = nextMessage();
    emitPartial({ type: 'final', text: 'Estoy diseñando una API escalable.' });
    const finalMessage = await finalMessagePromise;
    assert.equal(finalMessage.type, 'translation.result');
    assert.equal(finalMessage.originalText, 'Estoy diseñando una API escalable.');
    assert.equal(
      finalMessage.translatedText,
      'Translated: Estoy diseñando una API escalable.',
    );
    assert.deepEqual(streamedAudio, [audio]);
    assert.equal(translationRequests, 1);
    assert.equal(transcriptionRequests, 0);
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const socketClosed = once(socket, 'close');
      socket.close();
      await socketClosed;
    }
    await new Promise<void>((resolve, reject) => {
      streamingServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        streamingServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});

test('rejects unsigned Paddle events and activates Pro for a matching signed purchase', async () => {
  const profile: SubscriptionProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'buyer@example.com',
    plan: 'free_trial',
    paddle_customer_id: null,
    paddle_subscription_id: null,
    minutes_used: 0,
    minutes_limit: 15,
  };
  const subscriptionService = createSubscriptionService({
    env: {},
    initialProfiles: [profile],
  });
  const secret = 'test-webhook-secret';
  const webhookServer = createBridgeTalkServer({
    allowedOrigins: new Set(),
    contextManager: new ContextManager(),
    pipeline,
    subscriptionService,
    paddleWebhookSecret: secret,
    paddleProPriceId: 'pri_pro',
  });

  try {
    await new Promise<void>((resolve) => {
      webhookServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = webhookServer.server.address();
    assert.ok(address && typeof address !== 'string');
    const webhookUrl = `http://127.0.0.1:${address.port}/api/webhooks/paddle`;
    const event = {
      event_type: 'subscription.activated',
      data: {
        id: 'sub_123',
        customer_id: 'ctm_123',
        items: [{ price_id: 'pri_pro' }],
        custom_data: { user_id: '11111111-1111-4111-8111-111111111111' },
        customer: { email: 'buyer@example.com' },
      },
    };
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const validHash = createHmac('sha256', secret)
      .update(`${timestamp}:${body}`)
      .digest('hex');

    const unsignedResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(unsignedResponse.status, 401);
    assert.equal(
      (await subscriptionService.getProfile('11111111-1111-4111-8111-111111111111'))
        ?.plan,
      'free_trial',
    );

    const invalidSignatureResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Paddle-Signature': `ts=${timestamp};h1=${'0'.repeat(64)}`,
      },
      body,
    });
    assert.equal(invalidSignatureResponse.status, 401);

    const wrongPriceBody = JSON.stringify({
      ...event,
      data: { ...event.data, items: [{ price_id: 'pri_unrelated' }] },
    });
    const wrongPriceHash = createHmac('sha256', secret)
      .update(`${timestamp}:${wrongPriceBody}`)
      .digest('hex');
    const wrongPriceResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Paddle-Signature': `ts=${timestamp};h1=${wrongPriceHash}`,
      },
      body: wrongPriceBody,
    });
    assert.equal(wrongPriceResponse.status, 200);
    assert.equal(
      (await subscriptionService.getProfile('11111111-1111-4111-8111-111111111111'))
        ?.plan,
      'free_trial',
    );

    const signedResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Paddle-Signature': `ts=${timestamp};h1=${validHash}`,
      },
      body,
    });
    assert.equal(signedResponse.status, 200);
    assert.equal(
      (await subscriptionService.getProfile('11111111-1111-4111-8111-111111111111'))
        ?.plan,
      'pro',
    );
    assert.equal(
      (
        await subscriptionService.getProfile(
          '11111111-1111-4111-8111-111111111111',
        )
      )?.minutes_limit,
      900,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      webhookServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        webhookServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});

test('activates a matching Paddle transaction.completed event', async () => {
  const subscriptionService = createSubscriptionService({
    env: {},
    initialProfiles: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'transaction@example.com',
        plan: 'free_trial',
        paddle_customer_id: null,
        paddle_subscription_id: null,
        minutes_used: 0,
        minutes_limit: 15,
      },
    ],
  });
  const secret = 'test-webhook-secret';
  const webhookServer = createBridgeTalkServer({
    allowedOrigins: new Set(),
    contextManager: new ContextManager(),
    pipeline,
    subscriptionService,
    paddleWebhookSecret: secret,
    paddleProPriceId: 'pri_pro',
  });

  try {
    await new Promise<void>((resolve) => {
      webhookServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = webhookServer.server.address();
    assert.ok(address && typeof address !== 'string');
    const webhookUrl = `http://127.0.0.1:${address.port}/api/webhooks/paddle`;
    const body = JSON.stringify({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_123',
        subscription_id: 'sub_456',
        customer_id: 'ctm_456',
        items: [{ price_id: 'pri_pro' }],
        custom_data: { user_id: '22222222-2222-4222-8222-222222222222' },
        customer: { email: 'transaction@example.com' },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hash = createHmac('sha256', secret)
      .update(`${timestamp}:${body}`)
      .digest('hex');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Paddle-Signature': `ts=${timestamp};h1=${hash}`,
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(
      (
        await subscriptionService.getProfile(
          '22222222-2222-4222-8222-222222222222',
        )
      )?.plan,
      'pro',
    );
    assert.equal(
      (
        await subscriptionService.getProfile(
          '22222222-2222-4222-8222-222222222222',
        )
      )
        ?.paddle_subscription_id,
      'sub_456',
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      webhookServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        webhookServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});

test('blocks a user whose audio minutes are exhausted', async () => {
  const subscriptionService = createSubscriptionService({
    env: {},
    initialProfiles: [
      {
        id: 'demo-local',
        email: '',
        plan: 'free_trial',
        paddle_customer_id: null,
        paddle_subscription_id: null,
        minutes_used: 15,
        minutes_limit: 15,
      },
    ],
  });
  const limitedServer = createBridgeTalkServer({
    allowedOrigins: new Set(['http://localhost:5173']),
    subscriptionService,
  });

  try {
    await new Promise<void>((resolve) => {
      limitedServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = limitedServer.server.address();
    assert.ok(address && typeof address !== 'string');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/audio`, {
      origin: 'http://localhost:5173',
    });
    await once(socket, 'open');
    const responsePromise = once(socket, 'message');
    socket.send(
      JSON.stringify({
        type: 'session.start',
        sessionId: '33333333-3333-4333-8333-333333333333',
        sourceLanguage: 'es',
        targetLanguage: 'en',
        audioMimeType: 'audio/webm',
      }),
    );
    const [data] = await responsePromise;
    assert.ok(data instanceof Buffer);
    const event = JSON.parse(data.toString()) as Record<string, unknown>;

    assert.equal(event.type, 'error');
    assert.equal(event.code, 'AUDIO_MINUTE_LIMIT_REACHED');
    assert.match(String(event.message), /límite de minutos/i);
    const socketClosed = once(socket, 'close');
    socket.close();
    await socketClosed;
  } finally {
    await new Promise<void>((resolve, reject) => {
      limitedServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        limitedServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});

test('records elapsed audio minutes when a session stops', async () => {
  const subscriptionService = createSubscriptionService({
    env: {},
    initialProfiles: [
      {
        id: 'demo-local',
        email: '',
        plan: 'free_trial',
        paddle_customer_id: null,
        paddle_subscription_id: null,
        minutes_used: 0,
        minutes_limit: 15,
      },
    ],
  });
  const usageServer = createBridgeTalkServer({
    allowedOrigins: new Set(['http://localhost:5173']),
    subscriptionService,
  });
  let socket: WebSocket | null = null;

  try {
    await new Promise<void>((resolve) => {
      usageServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = usageServer.server.address();
    assert.ok(address && typeof address !== 'string');
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/audio`, {
      origin: 'http://localhost:5173',
    });
    await once(socket, 'open');
    const nextMessage = async (): Promise<Record<string, unknown>> => {
      const [data] = await once(socket as WebSocket, 'message');
      assert.ok(data instanceof Buffer);
      return JSON.parse(data.toString()) as Record<string, unknown>;
    };

    const started = nextMessage();
    socket.send(
      JSON.stringify({
        type: 'session.start',
        sessionId: '44444444-4444-4444-8444-444444444444',
        sourceLanguage: 'es',
        targetLanguage: 'en',
        audioMimeType: 'audio/webm',
      }),
    );
    assert.equal((await started).type, 'session.started');
    const stopped = nextMessage();
    socket.send(JSON.stringify({ type: 'session.stop' }));
    assert.equal((await stopped).type, 'session.stopped');
    assert.equal(
      (await subscriptionService.getProfile('demo-local'))?.minutes_used,
      1,
    );
  } finally {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const socketClosed = once(socket, 'close');
      socket.close();
      await socketClosed;
    }
    await new Promise<void>((resolve, reject) => {
      usageServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        usageServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});

test('requires a verified Supabase token before processing production audio', async () => {
  const authenticatedUserId = '55555555-5555-4555-8555-555555555555';
  const subscriptionService: SubscriptionService = {
    isPersistent: true,
    authenticateAudioUser: async (accessToken) =>
      accessToken === 'verified-access-token'
        ? { id: authenticatedUserId, email: 'user@example.com' }
        : null,
    canUseAudioStream: async () => true,
    getProfile: async () => null,
    recordConsumedMinutes: async () => undefined,
    activateProForPaddle: async () => true,
  };
  const authenticatedServer = createBridgeTalkServer({
    allowedOrigins: new Set(['http://localhost:5173']),
    subscriptionService,
  });
  const sockets: WebSocket[] = [];

  try {
    await new Promise<void>((resolve) => {
      authenticatedServer.server.listen(0, '127.0.0.1', resolve);
    });
    const address = authenticatedServer.server.address();
    assert.ok(address && typeof address !== 'string');
    const socketUrl = `ws://127.0.0.1:${address.port}/audio`;
    const unauthenticatedSocket = new WebSocket(socketUrl, {
      origin: 'http://localhost:5173',
    });
    sockets.push(unauthenticatedSocket);
    await once(unauthenticatedSocket, 'open');
    const unauthorizedResponse = once(unauthenticatedSocket, 'message');
    unauthenticatedSocket.send(
      JSON.stringify({
        type: 'session.start',
        sessionId: '66666666-6666-4666-8666-666666666666',
        sourceLanguage: 'es',
        targetLanguage: 'en',
        audioMimeType: 'audio/webm',
        userId: authenticatedUserId,
      }),
    );
    const [unauthorizedData] = await unauthorizedResponse;
    assert.ok(unauthorizedData instanceof Buffer);
    const unauthorizedEvent = JSON.parse(
      unauthorizedData.toString(),
    ) as Record<string, unknown>;
    assert.equal(unauthorizedEvent.code, 'AUTH_REQUIRED');

    const authorizedSocket = new WebSocket(socketUrl, {
      origin: 'http://localhost:5173',
    });
    sockets.push(authorizedSocket);
    await once(authorizedSocket, 'open');
    const authorizedResponse = once(authorizedSocket, 'message');
    authorizedSocket.send(
      JSON.stringify({
        type: 'session.start',
        sessionId: '77777777-7777-4777-8777-777777777777',
        sourceLanguage: 'es',
        targetLanguage: 'en',
        audioMimeType: 'audio/webm',
        accessToken: 'verified-access-token',
      }),
    );
    const [authorizedData] = await authorizedResponse;
    assert.ok(authorizedData instanceof Buffer);
    const authorizedEvent = JSON.parse(
      authorizedData.toString(),
    ) as Record<string, unknown>;
    assert.equal(authorizedEvent.type, 'session.started');
  } finally {
    await Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }
            socket.once('close', resolve);
            socket.close();
          }),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      authenticatedServer.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        authenticatedServer.server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });
    });
  }
});
