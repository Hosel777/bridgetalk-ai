import type { ReactElement } from 'react';
import {
  BookOpenCheck,
  Check,
  Gauge,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import type { LearningSummary } from '../services/learningSummaryService.js';

interface LearningModuleProps {
  summary?: string;
  autonomyScore?: number;
  learningSummary?: LearningSummary | null;
  isRefreshing?: boolean;
  refreshError?: string | null;
  learnedVocabularyGapIds?: ReadonlySet<string>;
  onRefresh?: () => void;
  onMarkLearned?: (id: string) => void;
}

const EMPTY_LEARNED_IDS: ReadonlySet<string> = new Set();

function canPracticePronunciation(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function practicePronunciation(text: string): void {
  if (!canPracticePronunciation()) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

interface VocabularyFlashcardsProps {
  gaps: LearningSummary['vocabularyGaps'];
  learnedIds: ReadonlySet<string>;
  onMarkLearned?: (id: string) => void;
}

function VocabularyFlashcards({
  gaps,
  learnedIds,
  onMarkLearned,
}: VocabularyFlashcardsProps): ReactElement {
  return (
    <div className="border-t border-slate-200 px-5 py-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-sm font-semibold text-slate-800">
          Flashcards / Repaso Técnico
        </h3>
        <p className="text-xs text-slate-500">
          {gaps.length} {gaps.length === 1 ? 'frase' : 'frases'}
        </p>
      </div>

      {gaps.length === 0 ? (
        <p className="mt-3 rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-600">
          Las frases técnicas Español→English aparecerán aquí durante la sesión.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {gaps.map((gap) => {
            const isLearned = learnedIds.has(gap.id);

            return (
              <li key={gap.id} className="rounded-md border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800">
                    {gap.category}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {gap.technicalTerm}
                  </span>
                  {isLearned && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      Aprendida
                    </span>
                  )}
                </div>
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Español
                    </dt>
                    <dd className="mt-1 text-sm leading-6 text-slate-800">
                      {gap.originalSpanish}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                      English corporativo nativo
                    </dt>
                    <dd className="mt-1 text-sm leading-6 text-slate-800">
                      {gap.nativeEnglish}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => practicePronunciation(gap.nativeEnglish)}
                    disabled={!canPracticePronunciation()}
                    className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Volume2 aria-hidden="true" className="h-4 w-4" />
                    Escuchar pronunciación
                  </button>
                  {onMarkLearned && (
                    <button
                      type="button"
                      onClick={() => onMarkLearned(gap.id)}
                      disabled={isLearned}
                      aria-pressed={isLearned}
                      className="inline-flex min-h-9 items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-default disabled:bg-emerald-700"
                    >
                      {isLearned ? 'Aprendida' : 'Marcar aprendida'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LearningModule({
  summary,
  autonomyScore,
  learningSummary,
  isRefreshing = false,
  refreshError = null,
  learnedVocabularyGapIds = EMPTY_LEARNED_IDS,
  onRefresh,
  onMarkLearned,
}: LearningModuleProps): ReactElement {
  const hasSummary = Boolean(summary?.trim());
  const score = learningSummary?.independenceScore ?? autonomyScore;
  const directInterventions = learningSummary?.directEnglishInterventions ?? 0;
  const translatedInterventions = learningSummary?.translatedInterventions ?? 0;
  const totalInterventions = directInterventions + translatedInterventions;
  const hasScore =
    typeof score === 'number' &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100;
  const vocabularyGaps = learningSummary?.vocabularyGaps ?? [];

  return (
    <section
      aria-labelledby="learning-heading"
      className="rounded-lg border border-slate-200 bg-white"
    >
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="learning-heading" className="text-base font-semibold text-slate-900">
            Aprendizaje de la sesión
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Resumen, autonomía lingüística y repaso técnico.
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            {isRefreshing ? 'Sincronizando…' : 'Sincronizar resumen'}
          </button>
        )}
      </header>

      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <div className="flex items-center gap-2">
            <BookOpenCheck aria-hidden="true" className="h-4 w-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-800">Resumen</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {hasSummary
              ? summary
              : 'El resumen estará disponible cuando finalice la reunión y se configure el análisis.'}
          </p>
        </div>

        <div className="border-t border-slate-100 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div className="flex items-center gap-2">
            <Gauge aria-hidden="true" className="h-4 w-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-slate-800">
              Índice de Independencia del Idioma
            </h3>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
            {hasScore ? `${Math.round(score)}%` : '—'}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Índice de Independencia del Idioma"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hasScore ? Math.round(score) : 0}
            aria-valuetext={
              hasScore
                ? `${Math.round(score)} por ciento; ${totalInterventions} intervenciones`
                : 'Sin datos'
            }
          >
            <div
              className="h-full rounded-full bg-teal-600 transition-[width]"
              style={{ width: `${hasScore ? Math.round(score) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {learningSummary
              ? totalInterventions > 0
                ? `${directInterventions} directas · ${translatedInterventions} asistidas`
                : 'Sin intervenciones registradas'
              : hasScore
                ? 'Participación independiente'
                : 'Sin datos de la sesión'}
          </p>
        </div>
      </div>

      {refreshError && (
        <p
          role="alert"
          className="mx-5 mb-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {refreshError}
        </p>
      )}

      <div className="border-t border-slate-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Plan de estudio rápido
        </h3>
        {learningSummary?.studyPlan.length ? (
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
            {learningSummary.studyPlan.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Sin términos técnicos que repasar todavía. Sincroniza el resumen después de
            practicar.
          </p>
        )}
      </div>

      <VocabularyFlashcards
        gaps={vocabularyGaps}
        learnedIds={learnedVocabularyGapIds}
        {...(onMarkLearned ? { onMarkLearned } : {})}
      />
    </section>
  );
}
