import { useEffect, useState, type ReactElement } from 'react';
import {
  cloneVoice,
  getVoiceProfile,
  recordVoiceSample,
  selectVoice as persistVoiceSelection,
  type VoiceChoice,
} from '../services/voiceService.js';

interface VoiceClonePanelProps {
  userId: string;
  accessToken: string | null;
  language: 'es' | 'en';
}

export function VoiceClonePanel({
  userId,
  accessToken,
  language,
}: VoiceClonePanelProps): ReactElement {
  const [selectedVoice, setSelectedVoice] = useState<VoiceChoice | null>(null);
  const [hasClonedVoice, setHasClonedVoice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<VoiceChoice | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void getVoiceProfile(userId, accessToken)
      .then((profile) => {
        if (!isCurrent) {
          return;
        }
        setSelectedVoice(profile.voiceType);
        setHasClonedVoice(profile.hasClonedVoice);
      })
      .catch((cause: unknown) => {
        if (isCurrent) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'No se pudo cargar la voz guardada.',
          );
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [accessToken, userId]);

  async function selectVoice(voice: VoiceChoice): Promise<void> {
    setError(null);
    setMessage(null);
    setIsSaving(voice);
    try {
      await persistVoiceSelection(userId, accessToken, voice);
      setSelectedVoice(voice);
      setMessage(
        voice === 'cloned'
          ? 'Tu voz clonada está activa para la entrevista.'
          : `La voz ${voice === 'male' ? 'masculina' : 'femenina'} está activa para la entrevista.`,
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo seleccionar la voz.',
      );
    } finally {
      setIsSaving(null);
    }
  }

  async function recordVoiceClone(): Promise<void> {
    setError(null);
    setMessage(null);
    setIsRecording(true);
    try {
      const audio = await recordVoiceSample((seconds) => {
        setCountdown(seconds);
        if (seconds === 0) {
          setIsRecording(false);
        }
      });
      setIsRecording(false);
      setIsCloning(true);
      const result = await cloneVoice(userId, accessToken, language, audio);
      setSelectedVoice(result.voiceType);
      setHasClonedVoice(true);
      setMessage('Tu voz clonada está activa para la entrevista.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo grabar o clonar tu voz.',
      );
    } finally {
      setIsRecording(false);
      setIsCloning(false);
      setCountdown(0);
    }
  }

  const isBusy =
    isLoading || isSaving !== null || isRecording || isCloning;

  return (
    <section
      aria-labelledby="voice-heading"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      <div>
        <h2 id="voice-heading" className="text-base font-semibold">
          Voz para la entrevista
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Elige una voz. Solo al grabar se enviará una muestra de 8 segundos a
          Cartesia para crear un clon privado.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Seleccionar voz de entrevista"
        aria-busy={isLoading}
      >
        {(
          [
            ['male', 'Voz Masculina'],
            ['female', 'Voz Femenina'],
            ['cloned', 'Mi Voz Clonada'],
          ] as const
        ).map(([voice, label]) => (
          <button
            key={voice}
            type="button"
            aria-pressed={selectedVoice === voice}
            disabled={isBusy || (voice === 'cloned' && !hasClonedVoice)}
            onClick={() => void selectVoice(voice)}
            className={`min-h-10 rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedVoice === voice
                ? 'border-teal-700 bg-teal-50 text-teal-900'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {isSaving === voice ? 'Activando…' : label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void recordVoiceClone()}
        disabled={isBusy}
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60"
      >
        {isRecording
          ? `Grabando… ${countdown} s`
          : isCloning
            ? 'Clonando…'
            : 'Grabar 8 segundos para clonar mi voz'}
      </button>

      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" aria-live="polite" className="text-sm text-emerald-800">
          {message}
        </p>
      )}
    </section>
  );
}
