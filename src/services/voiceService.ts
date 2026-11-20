import { getBackendUrl } from './backendUrl.js';

export type VoiceChoice = 'male' | 'female' | 'cloned';

export interface VoiceProfile {
  voiceId: string | null;
  voiceType: VoiceChoice | null;
  hasClonedVoice: boolean;
}

interface VoiceChangeResult {
  voiceId: string;
  voiceType: VoiceChoice;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('El servidor devolvió una respuesta inválida.');
  }
  if (!isRecord(payload)) {
    throw new Error('El servidor devolvió una respuesta inválida.');
  }
  if (!response.ok) {
    const error = isRecord(payload.error) ? payload.error : null;
    throw new Error(
      typeof error?.message === 'string'
        ? error.message
        : 'No se pudo actualizar la voz.',
    );
  }
  return payload;
}

function authorizationHeaders(accessToken: string | null): HeadersInit {
  return accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};
}

export async function getVoiceProfile(
  userId: string,
  accessToken: string | null,
): Promise<VoiceProfile> {
  const query = new URLSearchParams({ userId });
  const response = await fetch(getBackendUrl(`/api/voice?${query}`), {
    headers: authorizationHeaders(accessToken),
  });
  const payload = await readJsonResponse(response);
  const voiceType = payload.voiceType;
  const voiceId = payload.voiceId;
  if (
    (voiceType !== null &&
      voiceType !== 'male' &&
      voiceType !== 'female' &&
      voiceType !== 'cloned') ||
    (voiceId !== null && typeof voiceId !== 'string')
  ) {
    throw new Error('El servidor devolvió una voz guardada inválida.');
  }
  return {
    voiceId: typeof voiceId === 'string' ? voiceId : null,
    voiceType:
      voiceType === 'male' || voiceType === 'female' || voiceType === 'cloned'
        ? voiceType
        : null,
    hasClonedVoice: payload.hasClonedVoice === true,
  };
}

export async function selectVoice(
  userId: string,
  accessToken: string | null,
  voice: VoiceChoice,
): Promise<VoiceChangeResult> {
  const response = await fetch(getBackendUrl('/api/voice/select'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authorizationHeaders(accessToken),
    },
    body: JSON.stringify({ userId, voice }),
  });
  const payload = await readJsonResponse(response);
  if (typeof payload.voiceId !== 'string' || payload.voiceType !== voice) {
    throw new Error('El servidor no confirmó la voz seleccionada.');
  }
  return { voiceId: payload.voiceId, voiceType: voice };
}

export async function cloneVoice(
  userId: string,
  accessToken: string | null,
  language: 'es' | 'en',
  audio: Blob,
): Promise<VoiceChangeResult> {
  const query = new URLSearchParams({ userId, language });
  const response = await fetch(getBackendUrl(`/api/voice/clone?${query}`), {
    method: 'POST',
    headers: {
      'Content-Type': audio.type,
      ...authorizationHeaders(accessToken),
    },
    body: audio,
  });
  const payload = await readJsonResponse(response);
  if (typeof payload.voiceId !== 'string' || payload.voiceType !== 'cloned') {
    throw new Error('El servidor no confirmó la clonación de voz.');
  }
  return { voiceId: payload.voiceId, voiceType: 'cloned' };
}

export async function recordVoiceSample(
  onCountdown: (seconds: number) => void,
): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite grabar desde el micrófono.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador no admite grabación de audio.');
  }
  const mimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error('El navegador no ofrece un formato compatible con Cartesia.');
  }

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let recordingFailed = false;
  const chunks: Blob[] = [];

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream, { mimeType });
    const completedRecording = new Promise<Blob>((resolve) => {
      recorder?.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder?.addEventListener(
        'error',
        () => {
          recordingFailed = true;
          if (recorder?.state === 'recording') {
            recorder.stop();
          }
        },
        { once: true },
      );
      recorder?.addEventListener(
        'stop',
        () => resolve(new Blob(chunks, { type: mimeType })),
        { once: true },
      );
    });

    recorder.start();
    for (let seconds = 8; seconds > 0; seconds -= 1) {
      onCountdown(seconds);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
      if (recordingFailed) {
        break;
      }
    }
    onCountdown(0);
    if (recorder.state === 'recording') {
      recorder.stop();
    }
    const audio = await completedRecording;
    if (recordingFailed || audio.size === 0) {
      throw new Error('No se pudo completar una grabación de audio válida.');
    }
    return audio;
  } finally {
    if (recorder?.state === 'recording') {
      recorder.stop();
    }
    stream?.getTracks().forEach((track) => track.stop());
  }
}
