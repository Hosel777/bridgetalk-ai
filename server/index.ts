import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  AiPipelineError,
  createAiPipeline,
  type AiPipeline,
  type DeepgramTranscriptionEvent,
  type DeepgramTranscriptionStream,
} from './services/aiPipeline.js';
import {
  ContextManager,
  MAX_CONTEXT_CHARACTERS,
  isValidSessionId,
  type InterviewContext,
  type SessionLanguage,
} from './services/contextManager.js';
import {
  createSubscriptionService,
  type SubscriptionService,
} from './services/subscriptionService.js';
import { registerVoiceRoutes } from './voiceRoutes.js';

export const PORT = Number(process.env.PORT ?? 3001);
const MAX_AUDIO_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PENDING_AUDIO_BYTES = 2 * 1024 * 1024;
export const AUDIO_PATH = '/audio';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk)));
  }
  return Buffer.from(data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLanguage(value: unknown): value is SessionLanguage {
  return value === 'es' || value === 'en';
}

interface SessionStartMessage {
  type: 'session.start';
  sessionId: string;
  sourceLanguage: SessionLanguage;
  targetLanguage: SessionLanguage;
  audioMimeType: string;
  accessToken: string | null;
}

interface ServerOptions {
  allowedOrigins?: ReadonlySet<string>;
  contextManager?: ContextManager;
  pipeline?: AiPipeline;
  subscriptionService?: SubscriptionService;
  env?: NodeJS.ProcessEnv;
  paddleWebhookSecret?: string;
  paddleProPriceId?: string;
}

export interface BridgeTalkServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  contextManager: ContextManager;
}

function parseSessionStart(value: unknown): SessionStartMessage | null {
  const accessToken = isRecord(value) ? value.accessToken : undefined;
  if (
    !isRecord(value) ||
    value.type !== 'session.start' ||
    typeof value.sessionId !== 'string' ||
    !isValidSessionId(value.sessionId) ||
    !isLanguage(value.sourceLanguage) ||
    !isLanguage(value.targetLanguage) ||
    value.sourceLanguage === value.targetLanguage ||
    (accessToken !== undefined &&
      (typeof accessToken !== 'string' || accessToken.length > 8192))
  ) {
    return null;
  }

  const audioMimeType =
    typeof value.audioMimeType === 'string' ? value.audioMimeType : 'audio/webm';
  if (
    audioMimeType.length > 100 ||
    !audioMimeType.toLowerCase().startsWith('audio/')
  ) {
    return null;
  }

  return {
    type: 'session.start',
    sessionId: value.sessionId,
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
    audioMimeType,
    accessToken: typeof accessToken === 'string' ? accessToken : null,
  };
}

function getBearerToken(request: Request): string | null {
  const authorization = request.get('authorization');
  if (!authorization) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function verifyPaddleSignature(
  body: Buffer,
  signatureHeader: string | undefined,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (!signatureHeader) {
    return false;
  }
  const fields = signatureHeader.split(';').map((field) => field.trim());
  const timestampField = fields.find((field) => field.startsWith('ts='));
  const hashField = fields.find((field) => field.startsWith('h1='));
  const timestamp = timestampField?.slice(3);
  const suppliedHash = hashField?.slice(3);
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !suppliedHash ||
    !/^[a-f\d]{64}$/i.test(suppliedHash)
  ) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowMilliseconds / 1000 - timestampSeconds) > 5
  ) {
    return false;
  }

  const expectedHash = createHmac('sha256', secret)
    .update(`${timestamp}:`)
    .update(body)
    .digest();
  const actualHash = Buffer.from(suppliedHash, 'hex');
  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(actualHash, expectedHash)
  );
}

function getPaddleCustomerEmail(data: Record<string, unknown>): string | null {
  if (typeof data.customer_email === 'string') {
    return data.customer_email;
  }
  for (const field of ['customer', 'billing_details'] as const) {
    const value = data[field];
    if (isRecord(value) && typeof value.email === 'string') {
      return value.email;
    }
  }
  return null;
}

function containsPaddlePrice(
  data: Record<string, unknown>,
  expectedPriceId: string,
): boolean {
  if (!Array.isArray(data.items)) {
    return false;
  }
  return data.items.some((item: unknown) => {
    if (!isRecord(item)) {
      return false;
    }
    if (item.price_id === expectedPriceId) {
      return true;
    }
    return isRecord(item.price) && item.price.id === expectedPriceId;
  });
}

function getAllowedOrigins(): ReadonlySet<string> {
  const configuredOrigins = process.env.BRIDGETALK_ALLOWED_ORIGINS;
  const origins = configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  return new Set(origins);
}

function sendJson(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendPipelineFailure(
  socket: WebSocket,
  type: 'translation.result' | 'confidence.result',
  sourceLanguage: SessionLanguage,
  targetLanguage: SessionLanguage,
  error: unknown,
): void {
  const code = error instanceof AiPipelineError ? error.code : 'PIPELINE_ERROR';
  const message =
    error instanceof AiPipelineError
      ? error.message
      : 'The AI pipeline could not process this request.';
  sendJson(socket, {
    type,
    id: randomUUID(),
    sourceLanguage,
    targetLanguage,
    originalText: '',
    translatedText: '',
    audioBase64: null,
    audioMimeType: null,
    status: 'error',
    errorCode: code,
    errorMessage: message,
    timestamp: new Date().toISOString(),
  });
}

function readContextRequest(value: unknown): {
  sessionId: string;
  context: InterviewContext;
} | null {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== 'string' ||
    typeof value.candidateCv !== 'string' ||
    typeof value.jobDescription !== 'string' ||
    value.candidateCv.length > MAX_CONTEXT_CHARACTERS ||
    value.jobDescription.length > MAX_CONTEXT_CHARACTERS ||
    !isValidSessionId(value.sessionId)
  ) {
    return null;
  }

  return {
    sessionId: value.sessionId,
    context: {
      candidateCv: value.candidateCv.trim(),
      jobDescription: value.jobDescription.trim(),
    },
  };
}

function getPipelineConfiguration(pipelineEnv: NodeJS.ProcessEnv): {
  stt: string;
  llm: string;
  tts: string;
} {
  return {
    stt: pipelineEnv.DEEPGRAM_API_KEY?.trim() ? 'configured' : 'sandbox',
    llm: pipelineEnv.OPENAI_API_KEY?.trim() ? 'configured' : 'unconfigured',
    tts:
      pipelineEnv.CARTESIA_API_KEY?.trim() &&
      pipelineEnv.CARTESIA_VOICE_ID?.trim()
        ? 'configured'
        : 'unconfigured',
  };
}

export function createBridgeTalkServer(
  options: ServerOptions = {},
): BridgeTalkServer {
  const env = options.env ?? process.env;
  const app: Express = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const contextManager = options.contextManager ?? new ContextManager();
  const pipeline = options.pipeline ?? createAiPipeline({ env });
  const subscriptionService =
    options.subscriptionService ?? createSubscriptionService({ env });
  const paddleWebhookSecret = (
    options.paddleWebhookSecret ?? env.PADDLE_WEBHOOK_SECRET ?? ''
  ).trim();
  const paddleProPriceId = (
    options.paddleProPriceId ??
    env.PADDLE_PRO_PRICE_ID ??
    env.VITE_PADDLE_PRICE_ID ??
    ''
  ).trim();
  const sessionOwners = new Map<string, string>();
  const jsonParser = express.json({ limit: '100kb' });
  registerVoiceRoutes(app, { env, pipeline, subscriptionService });

  app.post(
    '/api/webhooks/paddle',
    express.raw({ type: 'application/json', limit: '100kb' }),
    async (request: Request, response: Response) => {
      if (!paddleWebhookSecret) {
        response.status(503).json({
          error: {
            code: 'PADDLE_WEBHOOK_NOT_CONFIGURED',
            message: 'Paddle webhook processing is not configured.',
          },
        });
        return;
      }
      if (!paddleProPriceId) {
        response.status(503).json({
          error: {
            code: 'PADDLE_PRICE_NOT_CONFIGURED',
            message: 'The Pro Paddle price is not configured.',
          },
        });
        return;
      }

      if (!Buffer.isBuffer(request.body)) {
        response.status(400).json({
          error: {
            code: 'INVALID_WEBHOOK_BODY',
            message: 'The Paddle webhook body must be valid JSON.',
          },
        });
        return;
      }
      if (
        !verifyPaddleSignature(
          request.body,
          request.get('Paddle-Signature'),
          paddleWebhookSecret,
        )
      ) {
        response.status(401).json({
          error: {
            code: 'INVALID_PADDLE_SIGNATURE',
            message: 'The Paddle webhook signature is missing or invalid.',
          },
        });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(request.body.toString('utf8'));
      } catch {
        response.status(400).json({
          error: {
            code: 'INVALID_WEBHOOK_BODY',
            message: 'The Paddle webhook body must be valid JSON.',
          },
        });
        return;
      }
      if (
        !isRecord(payload) ||
        typeof payload.event_type !== 'string' ||
        !isRecord(payload.data)
      ) {
        response.status(422).json({
          error: {
            code: 'INVALID_PADDLE_EVENT',
            message: 'The Paddle event payload is missing required fields.',
          },
        });
        return;
      }

      if (
        payload.event_type !== 'subscription.activated' &&
        payload.event_type !== 'transaction.completed'
      ) {
        response.status(200).json({ received: true, ignored: true });
        return;
      }

      const eventData = payload.data;
      if (!containsPaddlePrice(eventData, paddleProPriceId)) {
        response.status(200).json({ received: true, ignored: true });
        return;
      }
      const customData = isRecord(eventData.custom_data)
        ? eventData.custom_data
        : null;
      const userId =
        customData && typeof customData.user_id === 'string'
          ? customData.user_id
          : '';
      const email = getPaddleCustomerEmail(eventData)?.trim() ?? null;
      const customerId =
        typeof eventData.customer_id === 'string' ? eventData.customer_id : '';
      const subscriptionId =
        payload.event_type === 'subscription.activated'
          ? typeof eventData.id === 'string'
            ? eventData.id
            : null
          : typeof eventData.subscription_id === 'string'
            ? eventData.subscription_id
            : null;

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          userId,
        ) ||
        (email !== null &&
          (email.length > 254 || !email.includes('@'))) ||
        !/^ctm_[a-z\d]+$/i.test(customerId) ||
        subscriptionId === null ||
        subscriptionId.length > 100 ||
        (payload.event_type === 'transaction.completed' && email === null)
      ) {
        response.status(422).json({
          error: {
            code: 'INVALID_PADDLE_CUSTOMER',
            message:
              'The signed Paddle event must include valid user, subscription, and customer details.',
          },
        });
        return;
      }

      try {
        const activated = await subscriptionService.activateProForPaddle({
          userId,
          email,
          customerId,
          subscriptionId,
        });
        if (!activated) {
          response.status(409).json({
            error: {
              code: 'PADDLE_ACCOUNT_MISMATCH',
              message:
                'The Paddle customer email does not match the linked account.',
            },
          });
          return;
        }
      } catch {
        response.status(503).json({
          error: {
            code: 'PADDLE_ACTIVATION_FAILED',
            message: 'The subscription could not be updated. Retry the event.',
          },
        });
        return;
      }

      response.status(200).json({ received: true, activated: true });
    },
  );

  app.post(
    '/api/context',
    (request, response, next) => {
      jsonParser(request, response, (error: unknown) => {
        if (error) {
          const isTooLarge =
            isRecord(error) && typeof error.status === 'number' && error.status === 413;
          response.status(isTooLarge ? 413 : 400).json({
            error: {
              code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
              message: isTooLarge
                ? 'Context payload exceeds the 100 KB limit.'
                : 'Request body must be valid JSON.',
            },
          });
          return;
        }
        next();
      });
    },
    async (request: Request, response: Response) => {
      const input = readContextRequest(request.body);
      if (!input) {
        response.status(422).json({
          error: {
            code: 'INVALID_CONTEXT',
            message:
              'Provide a valid sessionId, candidateCv, and jobDescription within the size limits.',
          },
        });
        return;
      }
      const user = await subscriptionService.authenticateAudioUser(
        getBearerToken(request),
      );
      if (!user) {
        response.status(401).json({
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Sign in before saving interview context.',
          },
        });
        return;
      }
      const currentOwner = sessionOwners.get(input.sessionId);
      if (currentOwner && currentOwner !== user.id) {
        response.status(404).json({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'The requested session is not available.',
          },
        });
        return;
      }
      if (!contextManager.ensureSession(input.sessionId)) {
        response.status(503).json({
          error: {
            code: 'SESSION_LIMIT_REACHED',
            message: 'A new in-memory session could not be created.',
          },
        });
        return;
      }
      if (!contextManager.saveContext(input.sessionId, input.context)) {
        response.status(422).json({
          error: {
            code: 'INVALID_CONTEXT',
            message: 'Context could not be saved for this session.',
          },
        });
        return;
      }
      sessionOwners.set(input.sessionId, user.id);
      response.status(200).json({
        sessionId: input.sessionId,
        status: 'saved',
      });
    },
  );

  app.get(
    '/api/learning-summary',
    async (request: Request, response: Response) => {
    const sessionId = request.query.sessionId;
    if (typeof sessionId !== 'string' || !isValidSessionId(sessionId)) {
      response.status(400).json({
        error: {
          code: 'INVALID_SESSION_ID',
          message: 'Provide a valid sessionId query parameter.',
        },
      });
      return;
    }

    const user = await subscriptionService.authenticateAudioUser(
      getBearerToken(request),
    );
    if (!user) {
      response.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Sign in before reading interview learning data.',
        },
      });
      return;
    }
    const owner = sessionOwners.get(sessionId);
    if (subscriptionService.isPersistent && owner !== user.id) {
      response.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'The requested session is not available.',
        },
      });
      return;
    }

    const summary = contextManager.getLearningSummary(sessionId);
    if (!summary) {
      response.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'No learning data exists for this session.',
        },
      });
      return;
    }

    response.status(200).json({ sessionId, ...summary });
    },
  );

  const server: Server = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_AUDIO_PAYLOAD_BYTES,
  });
  const audioSessions = new Set<WebSocket>();
  const broadcastAudio = (data: Buffer, sender: WebSocket): void => {
    for (const session of audioSessions) {
      if (session !== sender && session.readyState === WebSocket.OPEN) {
        session.send(data);
      }
    }
  };
  const allowedOrigins = options.allowedOrigins ?? getAllowedOrigins();
  const pipelineConfiguration = getPipelineConfiguration(env);

  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== AUDIO_PATH) {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  });

  wss.on('connection', (webSocket: WebSocket) => {
    audioSessions.add(webSocket);
    let sessionId: string | null = null;
    let sessionActive = false;
    let sourceLanguage: SessionLanguage = 'es';
    let targetLanguage: SessionLanguage = 'en';
    let audioMimeType = 'audio/webm';
    let processingQueue = Promise.resolve();
    let deepgramStream: DeepgramTranscriptionStream | null = null;
    let isAuthorizingSession = false;
    let isStreamStarting = false;
    let sessionEnding = false;
    let sessionUserId: string | null = null;
    let sessionVoiceId: string | null = null;
    let sessionStartedAt: number | null = null;
    let usageRecorded = false;
    let streamGeneration = 0;
    let pendingAudio: Buffer[] = [];
    let pendingAudioBytes = 0;

    const enqueue = (task: () => Promise<void>): void => {
      processingQueue = processingQueue.then(task).catch((error: unknown) => {
        sendPipelineFailure(
          webSocket,
          'translation.result',
          sourceLanguage,
          targetLanguage,
          error,
        );
      });
    };

    const processTranscription = async (
      text: string,
      status: 'ok' | 'sandbox',
      activeSessionId: string,
      activeSourceLanguage: SessionLanguage,
      activeTargetLanguage: SessionLanguage,
    ): Promise<void> => {
      if (!text) {
        sendJson(webSocket, {
          type: 'translation.result',
          id: randomUUID(),
          sourceLanguage: activeSourceLanguage,
          targetLanguage: activeTargetLanguage,
          originalText: '',
          translatedText: '',
          audioBase64: null,
          audioMimeType: null,
          status,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      contextManager.recordIntervention(activeSessionId, activeSourceLanguage);
      const context = contextManager.getContext(activeSessionId) ?? {
        candidateCv: '',
        jobDescription: '',
      };
      const translatedText = await pipeline.translateWithContext(
        text,
        activeSourceLanguage,
        activeTargetLanguage,
        context,
      );
      contextManager.recordTranslation(activeSessionId, {
        sourceLanguage: activeSourceLanguage,
        targetLanguage: activeTargetLanguage,
        originalText: text,
        translatedText,
      });
      const audioOutput = await pipeline.synthesizeSpeech(
        translatedText,
        activeTargetLanguage,
        sessionVoiceId ?? undefined,
      );

      sendJson(webSocket, {
        type: 'translation.result',
        id: randomUUID(),
        sourceLanguage: activeSourceLanguage,
        targetLanguage: activeTargetLanguage,
        originalText: text,
        translatedText,
        audioBase64: audioOutput.toString('base64'),
        audioMimeType: 'audio/wav',
        status,
        timestamp: new Date().toISOString(),
      });
    };

    const processAudio = async (audio: Buffer): Promise<void> => {
      const activeSessionId = sessionId;
      if (!activeSessionId) {
        return;
      }

      const activeSourceLanguage = sourceLanguage;
      const activeTargetLanguage = targetLanguage;
      const transcription = await pipeline.transcribeAudio(
        audio,
        audioMimeType,
        activeSourceLanguage,
      );
      await processTranscription(
        transcription.text,
        transcription.status,
        activeSessionId,
        activeSourceLanguage,
        activeTargetLanguage,
      );
    };

    const processConfidenceSeal = async (): Promise<void> => {
      if (!sessionId) {
        return;
      }
      const context = contextManager.getContext(sessionId);
      if (!context || (!context.candidateCv && !context.jobDescription)) {
        sendJson(webSocket, {
          type: 'confidence.result',
          id: randomUUID(),
          sourceLanguage,
          targetLanguage,
          originalText: 'Presentación al reclutador',
          translatedText: '',
          audioBase64: null,
          audioMimeType: null,
          status: 'error',
          errorCode: 'CONTEXT_REQUIRED',
          errorMessage: 'Guarda el CV y la vacante antes de generar la presentación.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const translatedText = await pipeline.generateConfidenceSeal(
        context,
        targetLanguage,
      );
      const audioOutput = await pipeline.synthesizeSpeech(
        translatedText,
        targetLanguage,
        sessionVoiceId ?? undefined,
      );
      sendJson(webSocket, {
        type: 'confidence.result',
        id: randomUUID(),
        sourceLanguage,
        targetLanguage,
        originalText: 'Presentación al reclutador',
        translatedText,
        audioBase64: audioOutput.toString('base64'),
        audioMimeType: 'audio/wav',
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    };

    const reportStreamingError = (error: unknown): void => {
      sendJson(webSocket, {
        type: 'error',
        code:
          error instanceof AiPipelineError
            ? error.code
            : 'DEEPGRAM_STREAM_ERROR',
        message:
          error instanceof AiPipelineError
            ? error.message
            : 'The live transcription stream failed.',
      });
    };

    const handleDeepgramEvent = (
      event: DeepgramTranscriptionEvent,
      generation: number,
      activeSessionId: string,
      activeSourceLanguage: SessionLanguage,
      activeTargetLanguage: SessionLanguage,
    ): void => {
      if (generation !== streamGeneration || !sessionActive) {
        return;
      }

      if (event.type === 'partial') {
        if (!sessionEnding) {
          sendJson(webSocket, {
            type: 'transcription.partial',
            interimText: event.text,
            sourceLanguage: activeSourceLanguage,
            targetLanguage: activeTargetLanguage,
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      if (event.type === 'final') {
        enqueue(() =>
          processTranscription(
            event.text,
            'ok',
            activeSessionId,
            activeSourceLanguage,
            activeTargetLanguage,
          ),
        );
        return;
      }

      reportStreamingError(event.error);
    };

    const clearPendingAudio = (): void => {
      pendingAudio = [];
      pendingAudioBytes = 0;
    };

    const recordSessionUsage = async (): Promise<void> => {
      if (usageRecorded || !sessionUserId || sessionStartedAt === null) {
        return;
      }
      usageRecorded = true;
      try {
        await subscriptionService.recordConsumedMinutes(
          sessionUserId,
          Math.max(1, (Date.now() - sessionStartedAt) / 1000),
        );
      } catch {
        sendJson(webSocket, {
          type: 'error',
          code: 'AUDIO_USAGE_RECORD_FAILED',
          message: 'Audio usage could not be recorded. Please contact support.',
        });
      }
    };

    const finishSession = async (): Promise<void> => {
      const activeStream = deepgramStream;
      deepgramStream = null;
      try {
        await activeStream?.close();
        await processingQueue;
      } catch (error: unknown) {
        reportStreamingError(error);
      }
      await recordSessionUsage();
      sessionActive = false;
      sessionEnding = false;
      isAuthorizingSession = false;
      isStreamStarting = false;
      streamGeneration += 1;
      clearPendingAudio();
      sendJson(webSocket, { type: 'session.stopped' });
    };

    const startSession = (start: SessionStartMessage): void => {
      if (sessionActive || isAuthorizingSession || isStreamStarting) {
        sendJson(webSocket, {
          type: 'error',
          code: 'SESSION_ALREADY_STARTED',
          message: 'Stop the active audio session before starting another.',
        });
        return;
      }

      isAuthorizingSession = true;
      void (async (): Promise<void> => {
        try {
          const user = await subscriptionService.authenticateAudioUser(
            start.accessToken,
          );
          if (!user) {
            isAuthorizingSession = false;
            sendJson(webSocket, {
              type: 'error',
              code: 'AUTH_REQUIRED',
              message: 'Sign in before starting an audio session.',
            });
            return;
          }

          const currentOwner = sessionOwners.get(start.sessionId);
          if (currentOwner && currentOwner !== user.id) {
            isAuthorizingSession = false;
            sendJson(webSocket, {
              type: 'error',
              code: 'SESSION_NOT_FOUND',
              message: 'The requested session is not available.',
            });
            return;
          }

          if (!contextManager.ensureSession(start.sessionId)) {
            isAuthorizingSession = false;
            sendJson(webSocket, {
              type: 'error',
              code: 'SESSION_LIMIT_REACHED',
              message: 'A new in-memory session could not be created.',
            });
            return;
          }
          sessionOwners.set(start.sessionId, user.id);
          if (!(await subscriptionService.canUseAudioStream(user.id))) {
            isAuthorizingSession = false;
            sendJson(webSocket, {
              type: 'error',
              code: 'AUDIO_MINUTE_LIMIT_REACHED',
              message:
                'Has alcanzado el límite de minutos de tu plan. Actualiza tu suscripción para continuar.',
            });
            return;
          }
          const activeVoiceId =
            await subscriptionService.getCartesiaVoiceId(user.id);
          if (webSocket.readyState !== WebSocket.OPEN) {
            isAuthorizingSession = false;
            return;
          }

          sessionId = start.sessionId;
          sessionUserId = user.id;
          sessionVoiceId = activeVoiceId;
          sourceLanguage = start.sourceLanguage;
          targetLanguage = start.targetLanguage;
          audioMimeType = start.audioMimeType;
          sessionActive = true;
          sessionEnding = false;
          usageRecorded = false;
          sessionStartedAt = null;
          clearPendingAudio();
          const generation = ++streamGeneration;
          const activeSessionId = start.sessionId;
          const activeSourceLanguage = start.sourceLanguage;
          const activeTargetLanguage = start.targetLanguage;
          const openTranscriptionStream = pipeline.openTranscriptionStream;
          isAuthorizingSession = false;

          const sendSessionStarted = (): void => {
            sessionStartedAt = Date.now();
            sendJson(webSocket, {
              type: 'session.started',
              sessionId: activeSessionId,
              sourceLanguage: activeSourceLanguage,
              targetLanguage: activeTargetLanguage,
              pipeline: pipelineConfiguration,
            });
          };

          if (!openTranscriptionStream) {
            sendSessionStarted();
            return;
          }

          isStreamStarting = true;
          try {
            const stream = await openTranscriptionStream({
              audioMimeType: start.audioMimeType,
              sourceLanguage: activeSourceLanguage,
              onEvent: (event) =>
                handleDeepgramEvent(
                  event,
                  generation,
                  activeSessionId,
                  activeSourceLanguage,
                  activeTargetLanguage,
                ),
            });
            if (
              generation !== streamGeneration ||
              webSocket.readyState !== WebSocket.OPEN
            ) {
              await stream?.close();
              return;
            }

            deepgramStream = stream;
            isStreamStarting = false;
            const queuedAudio = pendingAudio;
            clearPendingAudio();
            for (const audio of queuedAudio) {
              if (stream) {
                stream.sendAudio(audio);
              } else {
                enqueue(() => processAudio(audio));
              }
            }
            sendSessionStarted();
            if (sessionEnding) {
              void finishSession();
            }
          } catch (error: unknown) {
            if (generation !== streamGeneration) {
              return;
            }
            sessionActive = false;
            sessionEnding = false;
            isStreamStarting = false;
            clearPendingAudio();
            reportStreamingError(error);
          }
        } catch (error: unknown) {
          isAuthorizingSession = false;
          sendJson(webSocket, {
            type: 'error',
            code: 'SUBSCRIPTION_CHECK_FAILED',
            message: 'Could not verify your audio plan. Please try again.',
          });
        }
      })();
    };

    webSocket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (isAuthorizingSession) {
          sendJson(webSocket, {
            type: 'error',
            code: 'SESSION_START_PENDING',
            message: 'Wait for the audio session to be authorized before sending audio.',
          });
          webSocket.close(1008, 'Audio session authorization pending');
          return;
        }
        const audio = toBuffer(data);
        if (!sessionActive) {
          if (subscriptionService.isPersistent) {
            sendJson(webSocket, {
              type: 'error',
              code: 'SESSION_NOT_STARTED',
              message: 'Authorize an audio session before sending audio.',
            });
          } else {
            broadcastAudio(audio, webSocket);
          }
          return;
        }
        if (sessionEnding) {
          return;
        }
        if (deepgramStream) {
          try {
            deepgramStream.sendAudio(audio);
          } catch (error: unknown) {
            reportStreamingError(error);
          }
          return;
        }
        if (isStreamStarting) {
          if (pendingAudioBytes + audio.length > MAX_PENDING_AUDIO_BYTES) {
            streamGeneration += 1;
            sessionActive = false;
            isStreamStarting = false;
            clearPendingAudio();
            reportStreamingError(
              new AiPipelineError(
                'AUDIO_STREAM_START_TIMEOUT',
                'Audio arrived before the live transcription stream was ready.',
              ),
            );
            return;
          }
          pendingAudio.push(audio);
          pendingAudioBytes += audio.length;
          return;
        }
        enqueue(() => processAudio(audio));
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        if (subscriptionService.isPersistent) {
          sendJson(webSocket, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Send a valid audio session message before streaming.',
          });
        } else {
          broadcastAudio(toBuffer(data), webSocket);
        }
        return;
      }

      if (isRecord(message) && message.type === 'session.stop') {
        if (sessionEnding) {
          return;
        }
        if (isAuthorizingSession) {
          sendJson(webSocket, {
            type: 'error',
            code: 'SESSION_START_PENDING',
            message: 'Wait for the audio session to be authorized before stopping it.',
          });
          return;
        }
        if (isStreamStarting) {
          sessionEnding = true;
          return;
        }
        if (sessionActive || deepgramStream) {
          sessionEnding = true;
          void finishSession();
          return;
        }
        sendJson(webSocket, { type: 'session.stopped' });
        return;
      }

      if (isRecord(message) && message.type === 'confidence.seal') {
        if (!sessionActive) {
          sendJson(webSocket, {
            type: 'error',
            code: 'SESSION_NOT_STARTED',
            message: 'Start a session before requesting a confidence seal.',
          });
          return;
        }
        processingQueue = processingQueue
          .then(processConfidenceSeal)
          .catch((error: unknown) => {
            sendPipelineFailure(
              webSocket,
              'confidence.result',
              sourceLanguage,
              targetLanguage,
              error,
            );
          });
        return;
      }

      const sessionStart = parseSessionStart(message);
      if (!sessionStart) {
        if (sessionActive || isAuthorizingSession || isStreamStarting) {
          sendJson(webSocket, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Unsupported or invalid audio session message.',
          });
        } else if (subscriptionService.isPersistent) {
          sendJson(webSocket, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Send a valid audio session message before streaming.',
          });
        } else {
          broadcastAudio(toBuffer(data), webSocket);
        }
        return;
      }

      startSession(sessionStart);
    });

    webSocket.on('close', () => {
      audioSessions.delete(webSocket);
      sessionActive = false;
      sessionEnding = true;
      streamGeneration += 1;
      isAuthorizingSession = false;
      isStreamStarting = false;
      clearPendingAudio();
      void finishSession();
    });

    webSocket.on('error', () => {
      console.error('WebSocket transport error.');
    });
  });

  return { app, server, wss, contextManager };
}

const defaultServer = createBridgeTalkServer();
const { app, server, wss } = defaultServer;

function startServer(): void {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  server.listen(PORT, () => {
    console.info(`Servidor escuchando en http://localhost:${PORT}`);
    console.info(`WebSocket de audio en ws://localhost:${PORT}${AUDIO_PATH}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer();
}

export { app, server, wss };
