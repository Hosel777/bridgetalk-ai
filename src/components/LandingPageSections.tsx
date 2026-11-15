import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react';
import type { LandingAccessMode } from './LandingPage.js';
import { PRICING_CONFIG, PRICING_FEATURES } from './landingPricingConfig.js';

interface LandingHeroProps {
  onStartTrial: () => void;
}

interface PricingSectionProps {
  accessMode: LandingAccessMode;
  isCheckoutLoading: boolean;
  checkoutError: string | null;
  onStartTrial: () => void;
  onSubscribe: () => void;
}

interface PlanCardProps {
  name: string;
  priceUsd: number;
  cadence: string;
  description: string;
  features: readonly string[];
  action: string;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  featured?: boolean;
}

export function LandingHero({
  onStartTrial,
}: LandingHeroProps): React.JSX.Element {
  return (
    <section
      id="inicio"
      className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:pb-28 md:pt-16"
    >
      <div>
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-teal-900">
          <span className="h-2 w-2 rounded-full bg-teal-700" />
          Tu voz, lista para el mundo
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
          Consigue empleos remotos en dólares{' '}
          <span className="text-teal-800">
            sin que el inglés sea una barrera hoy.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
          Habla con tu experiencia. BridgeTalk interpreta en tiempo real con
          contexto de tu CV y te ayuda a ganar independencia, entrevista a
          entrevista.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onStartTrial}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-800 px-5 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
          >
            {PRICING_CONFIG.trial.action}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <a
            href="#planes"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:border-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            Conocer BridgeTalk Pro
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          {PRICING_CONFIG.trial.durationMinutes} minutos gratis · Sin tarjeta ·
          Empieza en tu próxima entrevista
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <div
          aria-hidden="true"
          className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-amber-200/60 blur-3xl"
        />
        <div className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
                <AudioLines aria-hidden="true" className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Entrevista en vivo</p>
                <p className="text-xs text-slate-500">Español → Inglés</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Baja latencia
            </span>
          </div>
          <div className="space-y-4 py-6">
            <div className="max-w-[90%] rounded-xl rounded-tl-sm bg-slate-100 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tú · Español
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-800">
                Lideré la migración de nuestros servicios a la nube.
              </p>
            </div>
            <div className="ml-auto max-w-[90%] rounded-xl rounded-tr-sm bg-teal-800 px-4 py-3 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-100">
                Traducción contextual · English
              </p>
              <p className="mt-1 text-sm leading-6">
                I led the migration of our services to the cloud.
              </p>
            </div>
          </div>
          <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-teal-800" />
                Sello de Confianza
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Presentación clara y profesional para el reclutador.
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <GraduationCap aria-hidden="true" className="h-4 w-4 text-teal-800" />
                Índice de Independencia
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Mide tu progreso real al hablar inglés sin asistencia.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingDifferentiators(): React.JSX.Element {
  return (
    <section
      aria-labelledby="diferenciador-heading"
      className="border-y border-slate-200 bg-white"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[0.8fr_1.2fr] md:items-center md:py-20">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-teal-800">
            Más que traducción
          </p>
          <h2
            id="diferenciador-heading"
            className="mt-3 max-w-md text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Tu siguiente entrevista también te hace crecer.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">
            Cada conversación impulsa una presentación más sólida y un camino
            medible hacia la autonomía en inglés.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-teal-800">
              <ShieldCheck aria-hidden="true" className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-semibold">Sello de Confianza</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Una presentación al reclutador con tu experiencia y un mensaje
              profesional adaptado a la vacante.
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-teal-800">
              <GraduationCap aria-hidden="true" className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-semibold">Índice de Independencia</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Un indicador verificable que reconoce tus intervenciones directas
              en inglés y orienta tu práctica.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

export function PricingSection({
  accessMode,
  isCheckoutLoading,
  checkoutError,
  onStartTrial,
  onSubscribe,
}: PricingSectionProps): React.JSX.Element {
  const isPaddleMisconfigured = accessMode === 'misconfigured';

  return (
    <section
      id="planes"
      aria-labelledby="planes-heading"
      className="mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-teal-800">
          Empieza hoy
        </p>
        <h2
          id="planes-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Prueba gratis. Crece a tu ritmo.
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Empieza con una entrevista simulada y elige BridgeTalk Pro cuando
          quieras llevar tu preparación más lejos.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2 md:items-stretch">
        <PlanCard
          name={PRICING_CONFIG.trial.name}
          priceUsd={PRICING_CONFIG.trial.priceUsd}
          cadence={PRICING_CONFIG.trial.cadence}
          description={PRICING_CONFIG.trial.description}
          features={PRICING_FEATURES.trial}
          action={PRICING_CONFIG.trial.action}
          onSelect={onStartTrial}
        />
        <PlanCard
          name={PRICING_CONFIG.pro.name}
          priceUsd={PRICING_CONFIG.pro.priceUsd}
          cadence={PRICING_CONFIG.pro.cadence}
          description={PRICING_CONFIG.pro.description}
          features={PRICING_FEATURES.pro}
          action={PRICING_CONFIG.pro.action}
          onSelect={onSubscribe}
          disabled={isPaddleMisconfigured || isCheckoutLoading}
          loading={isCheckoutLoading}
          featured
        />
      </div>

      <div className="mx-auto mt-6 max-w-4xl">
        <p className="text-center text-xs leading-5 text-slate-500">
          {accessMode === 'demo'
            ? 'Modo de demostración: puedes entrar y probar el espacio sin iniciar un cobro.'
            : accessMode === 'paddle'
              ? 'El pago se procesa mediante Paddle Checkout. El acceso de producción debe validarse también desde el servidor.'
              : 'Configura VITE_PADDLE_CLIENT_TOKEN y VITE_PADDLE_PRICE_ID para habilitar el checkout.'}
        </p>
        {checkoutError && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-xl rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {checkoutError}
          </p>
        )}
      </div>
    </section>
  );
}

function PlanCard({
  name,
  priceUsd,
  cadence,
  description,
  features,
  action,
  onSelect,
  disabled = false,
  loading = false,
  featured = false,
}: PlanCardProps): React.JSX.Element {
  return (
    <article
      className={`relative flex flex-col rounded-xl border p-6 sm:p-7 ${
        featured
          ? 'border-teal-800 bg-white shadow-sm'
          : 'border-slate-200 bg-white'
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-teal-800 px-3 py-1 text-xs font-semibold text-white">
          Plan comercial
        </span>
      )}
      <div>
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="mt-1 min-h-10 text-sm leading-5 text-slate-600">
          {description}
        </p>
        <p className="mt-5 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight">
            ${priceUsd}
          </span>
          <span className="text-sm text-slate-500">{cadence}</span>
        </p>
      </div>
      <ul className="my-6 flex-1 space-y-3 border-t border-slate-100 pt-5">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex gap-2.5 text-sm leading-5 text-slate-700"
          >
            <Check
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-teal-800"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          featured
            ? 'bg-teal-800 text-white hover:bg-teal-900 focus-visible:outline-teal-800'
            : 'border border-slate-300 bg-white text-slate-800 hover:border-teal-700 hover:text-teal-900 focus-visible:outline-teal-700'
        }`}
      >
        {loading ? 'Abriendo Paddle…' : action}
        {!loading && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
      </button>
    </article>
  );
}
