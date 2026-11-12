import type { ReactElement } from 'react';
import { BookOpenCheck, Gauge } from 'lucide-react';

interface LearningModuleProps {
  summary?: string;
  autonomyScore?: number;
}

export function LearningModule({
  summary,
  autonomyScore,
}: LearningModuleProps): ReactElement {
  const hasSummary = Boolean(summary?.trim());
  const hasScore =
    typeof autonomyScore === 'number' &&
    Number.isFinite(autonomyScore) &&
    autonomyScore >= 0 &&
    autonomyScore <= 100;

  return (
    <section
      aria-labelledby="learning-heading"
      className="rounded-lg border border-slate-200 bg-white"
    >
      <header className="border-b border-slate-200 px-5 py-4">
        <h2 id="learning-heading" className="text-base font-semibold text-slate-900">
          Aprendizaje de la sesión
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Resumen e índice de autonomía después de la reunión.
        </p>
      </header>

      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
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
              Índice de autonomía
            </h3>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
            {hasScore ? `${Math.round(autonomyScore)}%` : '—'}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Índice de autonomía"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hasScore ? Math.round(autonomyScore) : 0}
            aria-valuetext={hasScore ? `${Math.round(autonomyScore)} por ciento` : 'Sin datos'}
          >
            <div
              className="h-full rounded-full bg-teal-600 transition-[width]"
              style={{ width: `${hasScore ? Math.round(autonomyScore) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {hasScore ? 'Participación independiente' : 'Sin datos de la sesión'}
          </p>
        </div>
      </div>
    </section>
  );
}
