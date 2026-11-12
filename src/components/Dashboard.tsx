import { useState, type ReactElement } from 'react';
import {
  Languages,
  Mic,
  MicOff,
  Radio,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type {
  AudioConnectionStatus,
  AudioLanguage,
} from '../services/audioStreamService.js';

type DashboardMode = 'interview' | 'translation' | 'practice';

interface DashboardProps {
  status: AudioConnectionStatus;
  connectionError: string | null;
  onToggleAudio: () => Promise<void>;
  sourceLanguage: AudioLanguage;
  onSourceLanguageChange: (language: AudioLanguage) => void;
  candidateCv: string;
  jobDescription: string;
  isContextSaved: boolean;
  isSavingContext: boolean;
  onCandidateCvChange: (value: string) => void;
  onJobDescriptionChange: (value: string) => void;
  onSaveContext: () => Promise<void>;
  onGenerateConfidenceSeal: () => Promise<void>;
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
  sourceLanguage,
  onSourceLanguageChange,
  candidateCv,
  jobDescription,
  isContextSaved,
  isSavingContext,
  onCandidateCvChange,
  onJobDescriptionChange,
  onSaveContext,
  onGenerateConfidenceSeal,
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
          <button
            type="button"
            onClick={() => void onGenerateConfidenceSeal()}
            disabled={!isConnected || !isContextSaved}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-700 bg-white px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            Sello de Confianza (Presentación al Reclutador)
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
        aria-labelledby="context-heading"
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      >
        <div>
          <h2 id="context-heading" className="text-base font-semibold">
            Contexto de entrevista
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Se guarda temporalmente en memoria del servidor y se comparte con OpenAI para
            contextualizar traducciones.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            CV y habilidades del candidato
            <textarea
              value={candidateCv}
              onChange={(event) => onCandidateCvChange(event.currentTarget.value)}
              maxLength={20_000}
              rows={5}
              placeholder="Pega aquí experiencia, habilidades y proyectos relevantes."
              className="mt-2 block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-500">
              {candidateCv.length.toLocaleString()} / 20.000
            </span>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Descripción de la vacante
            <textarea
              value={jobDescription}
              onChange={(event) => onJobDescriptionChange(event.currentTarget.value)}
              maxLength={20_000}
              rows={5}
              placeholder="Pega aquí responsabilidades y requisitos del puesto."
              className="mt-2 block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700"
            />
            <span className="mt-1 block text-right text-xs font-normal text-slate-500">
              {jobDescription.length.toLocaleString()} / 20.000
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void onSaveContext()}
            disabled={isSavingContext}
            className="min-h-10 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-60"
          >
            {isSavingContext ? 'Guardando…' : 'Guardar contexto'}
          </button>
          <span className="text-sm text-slate-500" aria-live="polite">
            {isContextSaved ? 'Contexto guardado para esta sesión.' : 'Cambios sin guardar.'}
          </span>
        </div>
      </section>

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

        <label className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <span className="font-medium">Dirección de traducción</span>
          <select
            value={sourceLanguage}
            onChange={(event) => {
              const language = event.currentTarget.value;
              if (language === 'es' || language === 'en') {
                onSourceLanguageChange(language);
              }
            }}
            disabled={status === 'connecting' || status === 'connected'}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="es">Español → English</option>
            <option value="en">English → Español</option>
          </select>
        </label>

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

