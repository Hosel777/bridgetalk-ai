import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard.js';
import { LearningModule } from './components/LearningModule.js';
import { TranslatorPanel } from './components/TranslatorPanel.js';
import {
  AudioStreamService,
  type AudioConnectionStatus,
  type AudioLanguage,
  type TranscriptEvent,
} from './services/audioStreamService.js';

function getAudioWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/audio`;
}

export default function App(): React.JSX.Element {
  const [audioService] = useState(() => new AudioStreamService());
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [status, setStatus] = useState<AudioConnectionStatus>('disconnected');
  const [sourceLanguage, setSourceLanguage] = useState<AudioLanguage>('es');
  const [transcripts, setTranscripts] = useState<TranscriptEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [candidateCv, setCandidateCv] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isContextSaved, setIsContextSaved] = useState(false);
  const [isSavingContext, setIsSavingContext] = useState(false);

  useEffect(
    () => () => {
      void audioService.disconnect();
    },
    [audioService],
  );

  async function toggleAudio(): Promise<void> {
    setConnectionError(null);
    if (status === 'connected') {
      await audioService.disconnect();
      return;
    }

    const targetLanguage: AudioLanguage = sourceLanguage === 'es' ? 'en' : 'es';
    try {
      await audioService.connect(getAudioWebSocketUrl(), {
        sessionId,
        sourceLanguage,
        targetLanguage,
        onStatusChange: setStatus,
        onError: (error) => setConnectionError(error.message),
        onEvent: (event) => {
          if (event.type === 'session.started') {
            setSessionId(event.sessionId);
          }
          if (
            event.type === 'translation.result' ||
            event.type === 'confidence.result'
          ) {
            setTranscripts((current) => [...current, event]);
            if (event.status === 'error') {
              setConnectionError(
                event.errorMessage ?? 'No se pudo completar el procesamiento de IA.',
              );
            }
          }
        },
      });
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error ? error.message : 'No se pudo iniciar el audio.',
      );
    }
  }

  async function saveContext(): Promise<void> {
    setConnectionError(null);
    setIsSavingContext(true);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, candidateCv, jobDescription }),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('El servidor devolvió una respuesta de contexto inválida.');
      }

      if (!response.ok) {
        const message =
          isRecord(payload) &&
          isRecord(payload.error) &&
          typeof payload.error.message === 'string'
            ? payload.error.message
            : 'No se pudo guardar el contexto de la entrevista.';
        throw new Error(message);
      }
      if (
        !isRecord(payload) ||
        payload.status !== 'saved' ||
        payload.sessionId !== sessionId
      ) {
        throw new Error('El servidor no confirmó el guardado del contexto.');
      }
      setIsContextSaved(true);
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error ? error.message : 'No se pudo guardar el contexto.',
      );
    } finally {
      setIsSavingContext(false);
    }
  }

  async function generateConfidenceSeal(): Promise<void> {
    setConnectionError(null);
    try {
      if (!isContextSaved) {
        throw new Error('Guarda el CV y la vacante antes de generar la presentación.');
      }
      audioService.sendConfidenceSeal();
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error ? error.message : 'No se pudo generar la presentación.',
      );
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <Dashboard
          status={status}
          connectionError={connectionError}
          onToggleAudio={toggleAudio}
          sourceLanguage={sourceLanguage}
          onSourceLanguageChange={setSourceLanguage}
          candidateCv={candidateCv}
          jobDescription={jobDescription}
          isContextSaved={isContextSaved}
          isSavingContext={isSavingContext}
          onCandidateCvChange={(value) => {
            setCandidateCv(value);
            setIsContextSaved(false);
          }}
          onJobDescriptionChange={(value) => {
            setJobDescription(value);
            setIsContextSaved(false);
          }}
          onSaveContext={saveContext}
          onGenerateConfidenceSeal={generateConfidenceSeal}
        />
        <TranslatorPanel
          entries={transcripts}
          isConnected={status === 'connected'}
        />
        <LearningModule />
      </div>
    </main>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
