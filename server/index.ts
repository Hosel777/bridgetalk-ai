import express, { type Express } from 'express';
import { createServer, type Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

const PORT = Number(process.env.PORT ?? 3001);
const MAX_AUDIO_PAYLOAD_BYTES = 1024 * 1024;
const AUDIO_PATH = '/audio';

const app: Express = express();
app.disable('x-powered-by');

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

const server: Server = createServer(app);

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_AUDIO_PAYLOAD_BYTES,
});

const audioSessions = new Set<WebSocket>();

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk)));
  }
  return Buffer.from(data);
}

function broadcastAudio(data: Buffer, sender: WebSocket): void {
  for (const session of audioSessions) {
    if (session !== sender && session.readyState === WebSocket.OPEN) {
      session.send(data);
    }
  }
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== AUDIO_PATH) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, request);
  });
});

wss.on('connection', (webSocket: WebSocket) => {
  audioSessions.add(webSocket);

  webSocket.on('message', (data: RawData) => {
    const audio = toBuffer(data);
    broadcastAudio(audio, webSocket);
  });

  webSocket.on('close', () => {
    audioSessions.delete(webSocket);
  });

  webSocket.on('error', (error: Error) => {
    console.error('Error de WebSocket:', error.message);
  });
});

server.listen(PORT, () => {
  console.info(`Servidor escuchando en http://localhost:${PORT}`);
  console.info(`WebSocket de audio en ws://localhost:${PORT}${AUDIO_PATH}`);
});

export { app, server, wss, PORT, AUDIO_PATH };
