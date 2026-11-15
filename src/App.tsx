import { useEffect, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard.js';
import { LearningModule } from './components/LearningModule.js';
import { TranslatorPanel } from './components/TranslatorPanel.js';
import {
  AudioStreamService,
  type AudioConnectionStatus,
  type AudioLanguage,
  type TranscriptEvent,
} from './services/audioStreamService.js';
import {
  fetchLearningSummary,
  type LearningSummary,
} from './services/learningSummaryService.js';
import {
  enumerateAudioDevices,
  requestAudioOutputDevice,
  type AudioDeviceCatalog,
} from './services/audioDeviceService.js';

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
  const [interimTranscript, setInterimTranscript] = useState('');
  const [interimLanguage, setInterimLanguage] = useState<AudioLanguage | null>(
    null,
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [candidateCv, setCandidateCv] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isContextSaved, setIsContextSaved] = useState(false);
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(
    null,
  );
  const [isRefreshingLearningSummary, setIsRefreshingLearningSummary] =
    useState(false);
  const [learningSummaryError, setLearningSummaryError] = useState<string | null>(
    null,
  );
  const [learnedVocabularyGapIds, setLearnedVocabularyGapIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const learningSummaryRequestId = useRef(0);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceCatalog>({
    inputs: [],
    outputs: [],
    supportsOutputRouting: false,
    supportsOutputPermissionPrompt: false,
  });
  const [inputDeviceId, setInputDeviceId] = useState('');
  const [outputDeviceId, setOutputDeviceId] = useState('');
  const [audioDeviceError, setAudioDeviceError] = useState<string | null>(null);
  const [isLoadingAudioDevices, setIsLoadingAudioDevices] = useState(true);
  const [audioDeviceRefreshKey, setAudioDeviceRefreshKey] = useState(0);

  useEffect(
    () => () => {
      learningSummaryRequestId.current += 1;
      void audioService.disconnect();
    },
    [audioService],
  );

  useEffect(() => {
    let isCurrent = true;
    setIsLoadingAudioDevices(true);

    void enumerateAudioDevices()
      .then((catalog) => {
        if (!isCurrent) {
          return;
        }
        setAudioDevices(catalog);
        setInputDeviceId((current) =>
          current && catalog.inputs.some((device) => device.deviceId === current)
            ? current
            : '',
        );
        setOutputDeviceId((current) =>
          current && catalog.outputs.some((device) => device.deviceId === current)
            ? current
            : '',
        );
        setAudioDeviceError(null);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setAudioDeviceError(
            error instanceof Error
              ? error.message
              : 'No se pudieron enumerar los dispositivos de audio.',
          );
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingAudioDevices(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [audioDeviceRefreshKey]);

  function refreshAudioDevices(): void {
    setAudioDeviceRefreshKey((current) => current + 1);
  }

  async function chooseAudioOutput(): Promise<void> {
    setAudioDeviceError(null);
    try {
      const selectedDevice = await requestAudioOutputDevice();
      setOutputDeviceId(selectedDevice.deviceId);
      refreshAudioDevices();
    } catch (error: unknown) {
      setAudioDeviceError(
        error instanceof Error
          ? error.message
          : 'No se pudo seleccionar la salida de audio.',
      );
    }
  }

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
        ...(inputDeviceId ? { inputDeviceId } : {}),
        onStatusChange: setStatus,
        onError: (error) => setConnectionError(error.message),
        onEvent: (event) => {
          if (event.type === 'session.started') {
            setInterimTranscript('');
            setInterimLanguage(null);
            setSessionId(event.sessionId);
            void refreshLearningSummary();
          }
          if (event.type === 'transcription.partial') {
            setInterimTranscript(event.interimText);
            setInterimLanguage(event.sourceLanguage);
          }
          if (event.type === 'session.stopped' || event.type === 'error') {
            setInterimTranscript('');
            setInterimLanguage(null);
          }
          if (
            event.type === 'translation.result' ||
            event.type === 'confidence.result'
          ) {
            setInterimTranscript('');
            setInterimLanguage(null);
            setTranscripts((current) => [...current, event]);
            if (event.status === 'error') {
              setConnectionError(
                event.errorMessage ?? 'No se pudo completar el procesamiento de IA.',
              );
            }
            if (
              event.type === 'translation.result' &&
              (event.originalText.trim() || event.status === 'error')
            ) {
              void refreshLearningSummary();
            }
          }
        },
      });
      refreshAudioDevices();
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error ? error.message : 'No se pudo iniciar el audio.',
      );
      refreshAudioDevices();
    }
  }

  async function refreshLearningSummary(): Promise<void> {
    const requestId = ++learningSummaryRequestId.current;
    setIsRefreshingLearningSummary(true);
    setLearningSummaryError(null);
    try {
      const summary = await fetchLearningSummary(sessionId);
      if (requestId === learningSummaryRequestId.current) {
        setLearningSummary(summary);
      }
    } catch (error: unknown) {
      if (requestId === learningSummaryRequestId.current) {
        setLearningSummaryError(
          error instanceof Error
            ? error.message
            : 'No se pudo sincronizar el resumen de aprendizaje.',
        );
      }
    } finally {
      if (requestId === learningSummaryRequestId.current) {
        setIsRefreshingLearningSummary(false);
      }
    }
  }

  function markVocabularyGapLearned(id: string): void {
    setLearnedVocabularyGapIds((current) => new Set(current).add(id));
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
          audioDevices={audioDevices}
          inputDeviceId={inputDeviceId}
          outputDeviceId={outputDeviceId}
          audioDeviceError={audioDeviceError}
          isLoadingAudioDevices={isLoadingAudioDevices}
          onInputDeviceChange={setInputDeviceId}
          onOutputDeviceChange={setOutputDeviceId}
          onRefreshAudioDevices={refreshAudioDevices}
          onChooseAudioOutput={() => void chooseAudioOutput()}
        />
        <TranslatorPanel
          entries={transcripts}
          isConnected={status === 'connected'}
          interimText={interimTranscript}
          interimLanguage={interimLanguage}
          outputDeviceId={outputDeviceId}
          supportsOutputRouting={audioDevices.supportsOutputRouting}
          onOutputError={setAudioDeviceError}
        />
        <LearningModule
          learningSummary={learningSummary}
          isRefreshing={isRefreshingLearningSummary}
          refreshError={learningSummaryError}
          learnedVocabularyGapIds={learnedVocabularyGapIds}
          onRefresh={() => void refreshLearningSummary()}
          onMarkLearned={markVocabularyGapLearned}
        />
      </div>
    </main>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
