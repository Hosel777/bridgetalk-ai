import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createBridgeTalkServer } from './index.js';

const bridgeTalk = createBridgeTalkServer({
  allowedOrigins: new Set(['http://localhost:5173']),
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
    bridgeTalk.webSocketServer.close((error) => {
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

test('serves a health response', async () => {
  const response = await fetch(`${serverUrl}/healthz`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test(
  'accepts a session and acknowledges binary audio without storing it',
  { timeout: 5000 },
  async () => {
    const socket = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/audio`, {
      origin: 'http://localhost:5173',
    });
    const initialMessage = once(socket, 'message');
    await once(socket, 'open');

    const nextMessage = async (): Promise<Record<string, unknown>> => {
      const [data] = await once(socket, 'message');
      assert.ok(data instanceof Buffer);
      return JSON.parse(data.toString()) as Record<string, unknown>;
    };

    const [initialData] = await initialMessage;
    assert.ok(initialData instanceof Buffer);
    assert.equal(
      (JSON.parse(initialData.toString()) as Record<string, unknown>).type,
      'connection.ready',
    );

    socket.send(
      JSON.stringify({
        type: 'session.start',
        sourceLanguage: 'es',
        targetLanguage: 'en',
      }),
    );
    assert.equal((await nextMessage()).type, 'session.started');

    socket.send(Buffer.from([1, 2, 3]));
    assert.deepEqual(await nextMessage(), {
      type: 'audio.received',
      bytes: 3,
      pipeline: 'unconfigured',
    });

    const socketClosed = once(socket, 'close');
    socket.close();
    await socketClosed;
  },
);
