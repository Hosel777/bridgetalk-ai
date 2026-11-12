import type { ReactElement } from 'react';
import { ArrowDown, ArrowRight, Languages } from 'lucide-react';
import type { TranscriptEvent } from '../services/audioStreamService.js';

interface TranslatorPanelProps {
  entries: TranscriptEvent[];
  isConnected: boolean;
}

function languageName(language: TranscriptEvent['sourceLanguage']): string {
  return language === 'es' ? 'Español' : 'English';
}

export function TranslatorPanel({
  entries,
  isConnected,
}: TranslatorPanelProps): ReactElement {
  return (
    <section
      aria-labelledby="translator-heading"
      className="rounded-lg border border-slate-200 bg-white"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 id="translator-heading" className="text-base font-semibold text-slate-900">
            Transcripción en vivo
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Subtítulos originales y traducción, lado a lado.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-2 text-sm text-slate-600"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
          />
          {isConnected ? 'Escuchando' : 'En espera'}
        </span>
      </header>

      {entries.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <Languages aria-hidden="true" className="h-7 w-7 text-slate-400" />
          <p className="mt-3 text-sm font-medium text-slate-700">
            Aquí aparecerán las conversaciones traducidas
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            {isConnected
              ? 'La conexión está activa. La transcripción aparecerá al conectar un proveedor de voz.'
              : 'Conecta el micrófono para iniciar una sesión bilingüe.'}
          </p>
        </div>
      ) : (
        <ol
          aria-live="polite"
          aria-relevant="additions"
          className="max-h-[28rem] space-y-4 overflow-y-auto p-5"
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              aria-label={
                entry.type === 'confidence.result'
                  ? 'Sello de Confianza'
                  : 'Traducción contextual'
              }
              className="grid gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 md:grid-cols-[1fr_auto_1fr]"
            >
              <article aria-label={`Original en ${languageName(entry.sourceLanguage)}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {entry.type === 'confidence.result'
                    ? 'Presentación'
                    : languageName(entry.sourceLanguage)}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-900">
                  {entry.originalText || 'No se detectó una frase de audio.'}
                </p>
              </article>
              <ArrowRight
                aria-hidden="true"
                className="hidden h-4 w-4 self-center text-slate-400 md:block"
              />
              <ArrowDown
                aria-hidden="true"
                className="h-4 w-4 text-slate-400 md:hidden"
              />
              <article aria-label={`Traducción al ${languageName(entry.targetLanguage)}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
                  {languageName(entry.targetLanguage)}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-900">
                  {entry.translatedText || entry.errorMessage || 'Sin traducción disponible.'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span
                    className={`text-xs font-medium ${
                      entry.status === 'error'
                        ? 'text-rose-700'
                        : entry.status === 'sandbox'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }`}
                  >
                    {entry.status === 'error'
                      ? 'Error'
                      : entry.status === 'sandbox'
                        ? 'Sandbox'
                        : 'Traducido'}
                  </span>
                  {entry.audioBase64 && entry.audioMimeType && (
                    <audio
                      controls
                      preload="none"
                      aria-label="Reproducir audio traducido"
                      className="h-9 max-w-full"
                      src={`data:${entry.audioMimeType};base64,${entry.audioBase64}`}
                    >
                      El navegador no puede reproducir este audio.
                    </audio>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
