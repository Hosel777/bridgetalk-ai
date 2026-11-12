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
  const [status, setStatus] = useState<AudioConnectionStatus>('disconnected');
  const [transcripts, setTranscripts] = useState<TranscriptEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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

    const sourceLanguage: AudioLanguage = 'es';
    const targetLanguage: AudioLanguage = 'en';
    try {
      await audioService.connect(getAudioWebSocketUrl(), {
        sourceLanguage,
        targetLanguage,
        onStatusChange: setStatus,
        onError: (error) => setConnectionError(error.message),
        onEvent: (event) => {
          if (event.type === 'transcript') {
            setTranscripts((current) => [...current, event]);
          }
        },
      });
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error ? error.message : 'No se pudo iniciar el audio.',
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
