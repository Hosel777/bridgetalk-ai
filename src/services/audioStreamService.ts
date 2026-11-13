export type AudioConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type AudioLanguage = 'es' | 'en';

export interface TranscriptEvent {
  type: 'translation.result' | 'confidence.result';
  id: string;
  sourceLanguage: AudioLanguage;
  targetLanguage: AudioLanguage;
  originalText: string;
  translatedText: string;
  audioBase64: string | null;
  audioMimeType: string | null;
  status: 'ok' | 'sandbox' | 'error';
  timestamp: string;
  errorCode?: string;
  errorMessage?: string;
}

export type AudioServerEvent =
  | {
      type: 'session.started';
      sessionId: string;
      sourceLanguage: AudioLanguage;
      targetLanguage: AudioLanguage;
      pipeline: Record<string, string>;
    }
  | { type: 'session.stopped' }
  | { type: 'audio.received'; bytes: number; pipeline: string }
  | TranscriptEvent
  | { type: 'error'; code: string; message: string };

export interface AudioStreamOptions {
  sourceLanguage: AudioLanguage;
  targetLanguage: AudioLanguage;
  sessionId?: string;
  inputDeviceId?: string;
  onEvent?: (event: AudioServerEvent) => void;
  onStatusChange?: (status: AudioConnectionStatus) => void;
  onError?: (error: Error) => void;
}

export const VOICE_ACTIVITY_RMS_THRESHOLD = 0.025;

export function shouldSendAudioChunk(
  hasData: boolean,
  voiceDetected: boolean,
): boolean {
  return hasData && voiceDetected;
}

export function hasVoiceActivity(
  samples: ArrayLike<number>,
  threshold = VOICE_ACTIVITY_RMS_THRESHOLD,
): boolean {
  if (samples.length === 0) {
    return false;
  }

  let squaredAmplitudeTotal = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = ((samples[index] ?? 128) - 128) / 128;
    squaredAmplitudeTotal += amplitude * amplitude;
  }

  const rootMeanSquare = Math.sqrt(squaredAmplitudeTotal / samples.length);
  return rootMeanSquare >= threshold;
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
    case 'session.started':
      if (
        typeof value.sessionId !== 'string' ||
        !isLanguage(value.sourceLanguage) ||
        !isLanguage(value.targetLanguage) ||
        !isRecord(value.pipeline)
      ) {
        return null;
      }
      return {
        type: 'session.started',
        sessionId: value.sessionId,
        sourceLanguage: value.sourceLanguage,
        targetLanguage: value.targetLanguage,
        pipeline: Object.fromEntries(
          Object.entries(value.pipeline).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
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
    case 'translation.result':
    case 'confidence.result':
      if (
        typeof value.id !== 'string' ||
        !isLanguage(value.sourceLanguage) ||
        !isLanguage(value.targetLanguage) ||
        typeof value.originalText !== 'string' ||
        typeof value.translatedText !== 'string' ||
        (typeof value.audioBase64 !== 'string' && value.audioBase64 !== null) ||
        (typeof value.audioMimeType !== 'string' && value.audioMimeType !== null) ||
        (value.status !== 'ok' && value.status !== 'sandbox' && value.status !== 'error') ||
        typeof value.timestamp !== 'string' ||
        (value.errorCode !== undefined && typeof value.errorCode !== 'string') ||
        (value.errorMessage !== undefined && typeof value.errorMessage !== 'string')
      ) {
        return null;
      }
      return {
        type: value.type,
        id: value.id,
        sourceLanguage: value.sourceLanguage,
        targetLanguage: value.targetLanguage,
        originalText: value.originalText,
        translatedText: value.translatedText,
        audioBase64: value.audioBase64,
        audioMimeType: value.audioMimeType,
        status: value.status,
        timestamp: value.timestamp,
        ...(typeof value.errorCode === 'string'
          ? { errorCode: value.errorCode }
          : {}),
        ...(typeof value.errorMessage === 'string'
          ? { errorMessage: value.errorMessage }
          : {}),
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
  private vadAudioContext: AudioContext | null = null;
  private vadAnalyser: AnalyserNode | null = null;
  private vadSourceNode: MediaStreamAudioSourceNode | null = null;
  private vadSamplingInterval: number | null = null;
  private voiceDetectedSinceLastChunk = false;
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
      if (typeof AudioContext === 'undefined') {
        throw new Error('This browser does not support voice activity detection.');
      }

      const audioContext = new AudioContext();
      this.vadAudioContext = audioContext;
      await audioContext.resume();
      if (connectionAttempt !== this.connectionAttempt) {
        return;
      }

      const audioConstraints: MediaTrackConstraints = options.inputDeviceId
        ? { deviceId: { exact: options.inputDeviceId } }
        : {};
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      if (connectionAttempt !== this.connectionAttempt) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mediaStream = mediaStream;
      this.startVoiceActivityDetection(mediaStream);

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
      const recorder = new MediaRecorder(this.mediaStream);
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', this.handleAudioData);
      recorder.addEventListener('error', this.handleRecorderError);
      socket.send(
        JSON.stringify({
          type: 'session.start',
          sessionId: options.sessionId,
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
          audioMimeType: recorder.mimeType || 'audio/webm',
        }),
      );
      recorder.start(1_000);
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

  sendConfidenceSeal(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Connect audio before requesting a confidence seal.');
    }
    this.socket.send(JSON.stringify({ type: 'confidence.seal' }));
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
    const hasData = event.data.size > 0;
    if (!hasData) {
      return;
    }

    const voiceWasDetected = this.voiceDetectedSinceLastChunk;
    this.voiceDetectedSinceLastChunk = false;
    if (
      shouldSendAudioChunk(hasData, voiceWasDetected) &&
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
    if (this.vadSamplingInterval !== null) {
      window.clearInterval(this.vadSamplingInterval);
      this.vadSamplingInterval = null;
    }
    this.vadSourceNode?.disconnect();
    this.vadSourceNode = null;
    this.vadAnalyser = null;
    this.voiceDetectedSinceLastChunk = false;
    const audioContext = this.vadAudioContext;
    this.vadAudioContext = null;
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch((error: unknown) => {
        this.options?.onError?.(
          error instanceof Error
            ? error
            : new Error('Could not close the voice activity detector.'),
        );
      });
    }
    if (this.recorder) {
      this.recorder.removeEventListener('dataavailable', this.handleAudioData);
      this.recorder.removeEventListener('error', this.handleRecorderError);
    }
    this.recorder = null;
  }

  private startVoiceActivityDetection(mediaStream: MediaStream): void {
    const audioContext = this.vadAudioContext;
    if (!audioContext) {
      throw new Error('Voice activity detection is not initialized.');
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    sourceNode.connect(analyser);

    this.vadAnalyser = analyser;
    this.vadSourceNode = sourceNode;
    const samples = new Uint8Array(analyser.fftSize);
    this.vadSamplingInterval = window.setInterval(() => {
      const currentAnalyser = this.vadAnalyser;
      if (!currentAnalyser) {
        return;
      }

      currentAnalyser.getByteTimeDomainData(samples);
      if (hasVoiceActivity(samples)) {
        this.voiceDetectedSinceLastChunk = true;
      }
    }, 50);
  }

  private setStatus(status: AudioConnectionStatus): void {
    this.options?.onStatusChange?.(status);
  }

  private reportError(error: Error): void {
    this.options?.onError?.(error);
    this.setStatus('error');
  }
}
