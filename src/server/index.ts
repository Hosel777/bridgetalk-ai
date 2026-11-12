import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';

const MAX_AUDIO_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

type Language = 'es' | 'en';

interface SessionStartMessage {
  type: 'session.start';
  sourceLanguage: Language;
  targetLanguage: Language;
}

interface ServerOptions {
  allowedOrigins?: ReadonlySet<string>;
}

export interface BridgeTalkServer {
  app: Express;
  server: Server;
  webSocketServer: WebSocketServer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

function parseSessionStart(value: unknown): SessionStartMessage | null {
  if (
    !isRecord(value) ||
    value.type !== 'session.start' ||
    !isLanguage(value.sourceLanguage) ||
    !isLanguage(value.targetLanguage) ||
    value.sourceLanguage === value.targetLanguage
  ) {
    return null;
  }

  return {
    type: 'session.start',
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
  };
}

function payloadByteLength(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  return data.byteLength;
}

function sendJson(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function getAllowedOrigins(): ReadonlySet<string> {
  const configuredOrigins = process.env.BRIDGETALK_ALLOWED_ORIGINS;
  const origins = configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  return new Set(origins);
}

export function createBridgeTalkServer(
  options: ServerOptions = {},
): BridgeTalkServer {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const server = createServer(app);
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_AUDIO_PAYLOAD_BYTES,
  });
  const allowedOrigins = options.allowedOrigins ?? getAllowedOrigins();

  server.on('upgrade', (request, socket, head) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (requestUrl.pathname !== '/audio') {
      socket.destroy();
      return;
    }

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      socket.write(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n',
      );
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    let sessionActive = false;
    sendJson(socket, {
      type: 'connection.ready',
      pipeline: {
        stt: 'unconfigured',
        llm: 'unconfigured',
        tts: 'unconfigured',
      },
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!sessionActive) {
          sendJson(socket, {
            type: 'error',
            code: 'SESSION_NOT_STARTED',
            message: 'Start a session before sending audio.',
          });
          return;
        }

        sendJson(socket, {
          type: 'audio.received',
          bytes: payloadByteLength(data),
          pipeline: 'unconfigured',
        });
        return;
      }

      let parsedMessage: unknown;
      try {
        parsedMessage = JSON.parse(data.toString());
      } catch {
        sendJson(socket, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Message must contain valid JSON.',
        });
        return;
      }

      if (
        isRecord(parsedMessage) &&
        parsedMessage.type === 'session.stop'
      ) {
        sessionActive = false;
        sendJson(socket, { type: 'session.stopped' });
        return;
      }

      const sessionStart = parseSessionStart(parsedMessage);
      if (!sessionStart) {
        sendJson(socket, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Unsupported or invalid session message.',
        });
        return;
      }

      sessionActive = true;
      sendJson(socket, {
        type: 'session.started',
        sourceLanguage: sessionStart.sourceLanguage,
        targetLanguage: sessionStart.targetLanguage,
      });
    });
  });

  return { app, server, webSocketServer };
}

function startServer(): void {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const { server } = createBridgeTalkServer();
  server.listen(port, () => {
    console.info(`BridgeTalk AI server listening on port ${port}.`);
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  startServer();
}
