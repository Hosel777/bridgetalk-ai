import { useState, type ReactElement } from 'react';
import { Languages, Mic, MicOff, Radio, Video } from 'lucide-react';
import type { AudioConnectionStatus } from '../services/audioStreamService.js';

type DashboardMode = 'interview' | 'translation' | 'practice';

interface DashboardProps {
  status: AudioConnectionStatus;
  connectionError: string | null;
  onToggleAudio: () => Promise<void>;
}

const modes: Array<{ id: DashboardMode; label: string; description: string }> = [
  {
    id: 'interview',
    label: 'Entrevista',
    description: 'Traducción y asistencia durante la entrevista.',
  },
  {
    id: 'translation',
    label: 'Traducción',
    description: 'Subtítulos bilingües en tiempo real.',
  },
  {
    id: 'practice',
    label: 'Práctica',
    description: 'Enfócate en una conversación de entrenamiento.',
  },
];

const connectionLabels: Record<AudioConnectionStatus, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando…',
  connected: 'Micrófono conectado',
  error: 'Error de conexión',
};

export function Dashboard({
  status,
  connectionError,
  onToggleAudio,
}: DashboardProps): ReactElement {
  const [mode, setMode] = useState<DashboardMode>('interview');

  const isConnected = status === 'connected';

  return (
    <>
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
            <Radio aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-800">
              BridgeTalk AI
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              Espacio de conversación
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center gap-2 text-sm text-slate-600"
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                isConnected
                  ? 'bg-emerald-500'
                  : status === 'error'
                    ? 'bg-rose-500'
                    : 'bg-slate-300'
              }`}
            />
            {connectionLabels[status]}
          </span>
          <button
            type="button"
            onClick={() => void onToggleAudio()}
            disabled={status === 'connecting'}
            aria-label={isConnected ? 'Desconectar micrófono' : 'Conectar micrófono'}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isConnected ? (
              <MicOff aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Mic aria-hidden="true" className="h-4 w-4" />
            )}
            {isConnected ? 'Desconectar audio' : 'Conectar audio'}
          </button>
        </div>
      </header>

      {connectionError && (
        <p
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {connectionError}
        </p>
      )}

      <section
        aria-labelledby="mode-heading"
        className="rounded-lg border border-slate-200 bg-white p-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="mode-heading" className="text-base font-semibold">
              Modo de sesión
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {modes.find((item) => item.id === mode)?.description}
            </p>
          </div>
          <div
            className="inline-flex flex-wrap gap-1 rounded-md bg-slate-100 p-1"
            role="group"
            aria-label="Seleccionar modo de sesión"
          >
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                onClick={() => setMode(item.id)}
                className={`min-h-9 rounded px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${
                  mode === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <span className="inline-flex items-center gap-2">
            <Video aria-hidden="true" className="h-4 w-4 text-slate-400" />
            Reunión remota
          </span>
          <span className="inline-flex items-center gap-2">
            <Languages aria-hidden="true" className="h-4 w-4 text-teal-700" />
            Español <span aria-hidden="true">↔</span> English
          </span>
        </div>
      </section>
    </>
  );
}

