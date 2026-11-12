export type AudioConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type AudioLanguage = 'es' | 'en';

export interface TranscriptEvent {
  type: 'transcript';
  id: string;
  sourceLanguage: AudioLanguage;
  targetLanguage: AudioLanguage;
  sourceText: string;
  translatedText: string;
  timestamp: string;
}

export type AudioServerEvent =
  | { type: 'connection.ready'; pipeline: Record<string, string> }
  | {
      type: 'session.started';
      sourceLanguage: AudioLanguage;
      targetLanguage: AudioLanguage;
    }
  | { type: 'session.stopped' }
  | { type: 'audio.received'; bytes: number; pipeline: string }
  | TranscriptEvent
  | { type: 'error'; code: string; message: string };

export interface AudioStreamOptions {
  sourceLanguage: AudioLanguage;
  targetLanguage: AudioLanguage;
  onEvent?: (event: AudioServerEvent) => void;
  onStatusChange?: (status: AudioConnectionStatus) => void;
  onError?: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLanguage(value: unknown): value is AudioLanguage {
  return value === 'es' || value === 'en';
}

function parseServerEvent(value: unknown): AudioServerEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  switch (value.type) {
    case 'connection.ready':
      if (!isRecord(value.pipeline)) {
        return null;
      }
      return {
        type: 'connection.ready',
        pipeline: Object.fromEntries(
          Object.entries(value.pipeline).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
      };
    case 'session.started':
      if (!isLanguage(value.sourceLanguage) || !isLanguage(value.targetLanguage)) {
        return null;
      }
      return {
        type: 'session.started',
        sourceLanguage: value.sourceLanguage,
        targetLanguage: value.targetLanguage,
      };
    case 'session.stopped':
      return { type: 'session.stopped' };
    case 'audio.received':
      if (typeof value.bytes !== 'number' || typeof value.pipeline !== 'string') {
        return null;
      }
      return {
        type: 'audio.received',
        bytes: value.bytes,
        pipeline: value.pipeline,
      };
    case 'transcript':
      if (
        typeof value.id !== 'string' ||
        !isLanguage(value.sourceLanguage) ||
        !isLanguage(value.targetLanguage) ||
        typeof value.sourceText !== 'string' ||
        typeof value.translatedText !== 'string' ||
        typeof value.timestamp !== 'string'
      ) {
        return null;
      }
      return {
        type: 'transcript',
        id: value.id,
        sourceLanguage: value.sourceLanguage,
        targetLanguage: value.targetLanguage,
        sourceText: value.sourceText,
        translatedText: value.translatedText,
        timestamp: value.timestamp,
      };
    case 'error':
      if (typeof value.code !== 'string' || typeof value.message !== 'string') {
        return null;
      }
      return {
        type: 'error',
        code: value.code,
        message: value.message,
      };
    default:
      return null;
  }
}

export class AudioStreamService {
  private socket: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private options: AudioStreamOptions | null = null;
  private closing = false;
  private connectionAttempt = 0;

  async connect(url: string, options: AudioStreamOptions): Promise<void> {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      throw new Error('An audio stream connection is already active.');
    }
    if (options.sourceLanguage === options.targetLanguage) {
      throw new Error('Source and target languages must be different.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support microphone access.');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser does not support audio recording.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('The WebSocket URL is invalid.');
    }
    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
      throw new Error('The audio stream URL must use ws:// or wss://.');
    }

    this.options = options;
    this.closing = false;
    const connectionAttempt = ++this.connectionAttempt;
    this.setStatus('connecting');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (connectionAttempt !== this.connectionAttempt) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mediaStream = mediaStream;

      const socket = new WebSocket(parsedUrl.toString());
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('message', this.handleMessage);
      socket.addEventListener('close', () => this.handleClose(socket), {
        once: true,
      });

      await new Promise<void>((resolve, reject) => {
        const failConnection = (): void => {
          reject(new Error('Could not connect to the audio server.'));
        };
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', failConnection, { once: true });
        socket.addEventListener('close', failConnection, { once: true });
      });

      if (connectionAttempt !== this.connectionAttempt) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'session.start',
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
        }),
      );

      const recorder = new MediaRecorder(this.mediaStream);
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', this.handleAudioData);
      recorder.addEventListener('error', this.handleRecorderError);
      recorder.start(250);
      this.setStatus('connected');
    } catch (error: unknown) {
      const connectionError =
        error instanceof Error ? error : new Error('Could not start audio capture.');
      if (connectionAttempt !== this.connectionAttempt) {
        return;
      }
      this.closing = true;
      this.releaseMedia();
      const failedSocket = this.socket;
      this.socket = null;
      failedSocket?.close();
      this.setStatus('error');
      options.onError?.(connectionError);
      throw connectionError;
    }
  }

  async disconnect(): Promise<void> {
    this.connectionAttempt += 1;
    this.closing = true;
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.recorder = null;
    this.releaseMedia();

    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'session.stop' }));
    }
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const socketClosed = new Promise<void>((resolve) => {
        socket.addEventListener('close', () => resolve(), { once: true });
      });
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, 'Audio capture stopped');
      }
      await socketClosed;
    }

    if (this.socket === socket) {
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  private readonly handleMessage = (message: MessageEvent<unknown>): void => {
    if (typeof message.data !== 'string') {
      this.reportError(new Error('The audio server sent an unsupported message.'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      this.reportError(new Error('The audio server sent invalid JSON.'));
      return;
    }

    const event = parseServerEvent(parsed);
    if (!event) {
      this.reportError(new Error('The audio server sent an invalid event.'));
      return;
    }
    if (event.type === 'error') {
      this.reportError(new Error(event.message));
    }
    this.options?.onEvent?.(event);
  };

  private readonly handleAudioData = (event: BlobEvent): void => {
    if (
      event.data.size > 0 &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      this.socket.send(event.data);
    }
  };

  private readonly handleRecorderError = (): void => {
    this.reportError(new Error('Microphone audio capture failed.'));
  };

  private readonly handleClose = (socket: WebSocket): void => {
    if (this.socket !== socket) {
      return;
    }
    this.releaseMedia();
    this.recorder = null;
    this.socket = null;
    if (!this.closing) {
      this.setStatus('disconnected');
    }
  };

  private releaseMedia(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    if (this.recorder) {
      this.recorder.removeEventListener('dataavailable', this.handleAudioData);
      this.recorder.removeEventListener('error', this.handleRecorderError);
    }
    this.recorder = null;
  }

  private setStatus(status: AudioConnectionStatus): void {
    this.options?.onStatusChange?.(status);
  }

  private reportError(error: Error): void {
    this.options?.onError?.(error);
    this.setStatus('error');
  }
}
