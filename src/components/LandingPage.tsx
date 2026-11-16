import { Languages, Radio } from 'lucide-react';
import {
  EmailAuthPanel,
  type LandingAuthMode,
} from './EmailAuthPanel.js';
import {
  LandingDifferentiators,
  LandingHero,
  PricingSection,
} from './LandingPageSections.js';

export { PRICING_CONFIG } from './landingPricingConfig.js';
export type { LandingAuthMode } from './EmailAuthPanel.js';

export type LandingAccessMode = 'demo' | 'paddle' | 'misconfigured';

interface LandingPageProps {
  accessMode: LandingAccessMode;
  authEnabled: boolean;
  authConfigurationError: string | null;
  authMode: LandingAuthMode;
  isAuthLoading: boolean;
  authError: string | null;
  authMessage: string | null;
  isCheckoutLoading: boolean;
  checkoutError: string | null;
  onSignIn: () => void;
  onAuthModeChange: (mode: LandingAuthMode) => void;
  onAuthenticate: (email: string, password: string) => void;
  onStartTrial: () => void;
  onSubscribe: () => void;
}

export function LandingPage({
  accessMode,
  authEnabled,
  authConfigurationError,
  authMode,
  isAuthLoading,
  authError,
  authMessage,
  isCheckoutLoading,
  checkoutError,
  onSignIn,
  onAuthModeChange,
  onAuthenticate,
  onStartTrial,
  onSubscribe,
}: LandingPageProps): React.JSX.Element {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-50 text-slate-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <a
          href="#inicio"
          className="flex items-center gap-3"
          aria-label="BridgeTalk AI, inicio"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-800 text-white">
            <Radio aria-hidden="true" className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            BridgeTalk AI
          </span>
        </a>
        <nav className="flex items-center gap-5">
          <a
            href="#planes"
            className="hidden text-sm font-medium text-slate-600 hover:text-teal-900 sm:inline"
          >
            Planes
          </a>
          {(authEnabled || authConfigurationError) && (
            <a
              href="#acceso"
              onClick={onSignIn}
              className="text-sm font-semibold text-slate-700 hover:text-teal-900"
            >
              Iniciar sesión
            </a>
          )}
          {!authEnabled && !authConfigurationError && accessMode === 'demo' && (
            <button
              type="button"
              onClick={onSignIn}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-teal-700 hover:text-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              Entrar a la demo
            </button>
          )}
        </nav>
      </header>

      <LandingHero onStartTrial={onStartTrial} />
      <LandingDifferentiators />
      {(authEnabled || authConfigurationError) && (
        <EmailAuthPanel
          enabled={authEnabled}
          configurationError={authConfigurationError}
          mode={authMode}
          isLoading={isAuthLoading}
          error={authError}
          message={authMessage}
          onModeChange={onAuthModeChange}
          onAuthenticate={onAuthenticate}
        />
      )}
      <PricingSection
        accessMode={accessMode}
        isCheckoutLoading={isCheckoutLoading}
        checkoutError={checkoutError}
        onStartTrial={onStartTrial}
        onSubscribe={onSubscribe}
      />

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} BridgeTalk AI</span>
          <span className="inline-flex items-center gap-2">
            <Languages aria-hidden="true" className="h-4 w-4 text-teal-800" />
            Entrevistas globales, sin barreras de idioma.
          </span>
        </div>
      </footer>
    </main>
  );
}
