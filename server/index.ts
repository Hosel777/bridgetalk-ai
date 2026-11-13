import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  AiPipelineError,
  createAiPipeline,
  type AiPipeline,
} from './services/aiPipeline.js';
import {
  ContextManager,
  MAX_CONTEXT_CHARACTERS,
  isValidSessionId,
  type InterviewContext,
  type SessionLanguage,
} from './services/contextManager.js';

export const PORT = Number(process.env.PORT ?? 3001);
const MAX_AUDIO_PAYLOAD_BYTES = 1024 * 1024;
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
}

interface ServerOptions {
  allowedOrigins?: ReadonlySet<string>;
  contextManager?: ContextManager;
  pipeline?: AiPipeline;
}

export interface BridgeTalkServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  contextManager: ContextManager;
}

function parseSessionStart(value: unknown): SessionStartMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'session.start' ||
    typeof value.sessionId !== 'string' ||
    !isValidSessionId(value.sessionId) ||
    !isLanguage(value.sourceLanguage) ||
    !isLanguage(value.targetLanguage) ||
    value.sourceLanguage === value.targetLanguage
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
  };
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
  const app: Express = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const contextManager = options.contextManager ?? new ContextManager();
  const pipeline = options.pipeline ?? createAiPipeline();
  const jsonParser = express.json({ limit: '100kb' });

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
    (request: Request, response: Response) => {
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
      response.status(200).json({
        sessionId: input.sessionId,
        status: 'saved',
      });
    },
  );

  app.get('/api/learning-summary', (request: Request, response: Response) => {
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
  });

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
  const pipelineConfiguration = getPipelineConfiguration(process.env);

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

    const processAudio = async (audio: Buffer): Promise<void> => {
      if (!sessionId) {
        return;
      }
      const transcription = await pipeline.transcribeAudio(
        audio,
        audioMimeType,
        sourceLanguage,
      );
      if (!transcription.text) {
        sendJson(webSocket, {
          type: 'translation.result',
          id: randomUUID(),
          sourceLanguage,
          targetLanguage,
          originalText: '',
          translatedText: '',
          audioBase64: null,
          audioMimeType: null,
          status: transcription.status,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      contextManager.recordIntervention(sessionId, sourceLanguage);
      const context = contextManager.getContext(sessionId) ?? {
        candidateCv: '',
        jobDescription: '',
      };
      const translatedText = await pipeline.translateWithContext(
        transcription.text,
        sourceLanguage,
        targetLanguage,
        context,
      );
      contextManager.recordTranslation(sessionId, {
        sourceLanguage,
        targetLanguage,
        originalText: transcription.text,
        translatedText,
      });
      const audioOutput = await pipeline.synthesizeSpeech(
        translatedText,
        targetLanguage,
      );

      sendJson(webSocket, {
        type: 'translation.result',
        id: randomUUID(),
        sourceLanguage,
        targetLanguage,
        originalText: transcription.text,
        translatedText,
        audioBase64: audioOutput.toString('base64'),
        audioMimeType: 'audio/wav',
        status: transcription.status,
        timestamp: new Date().toISOString(),
      });
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

    webSocket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        const audio = toBuffer(data);
        if (!sessionActive) {
          broadcastAudio(audio, webSocket);
          return;
        }
        enqueue(() => processAudio(audio));
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        broadcastAudio(toBuffer(data), webSocket);
        return;
      }

      if (isRecord(message) && message.type === 'session.stop') {
        sessionActive = false;
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
        if (sessionActive) {
          sendJson(webSocket, {
            type: 'error',
            code: 'INVALID_MESSAGE',
            message: 'Unsupported or invalid audio session message.',
          });
        } else {
          broadcastAudio(toBuffer(data), webSocket);
        }
        return;
      }

      if (!contextManager.ensureSession(sessionStart.sessionId)) {
        sendJson(webSocket, {
          type: 'error',
          code: 'SESSION_LIMIT_REACHED',
          message: 'A new in-memory session could not be created.',
        });
        return;
      }

      sessionId = sessionStart.sessionId;
      sourceLanguage = sessionStart.sourceLanguage;
      targetLanguage = sessionStart.targetLanguage;
      audioMimeType = sessionStart.audioMimeType;
      sessionActive = true;
      sendJson(webSocket, {
        type: 'session.started',
        sessionId,
        sourceLanguage,
        targetLanguage,
        pipeline: pipelineConfiguration,
      });
    });

    webSocket.on('close', () => {
      audioSessions.delete(webSocket);
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
