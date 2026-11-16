import { useState } from 'react';

export type LandingAuthMode = 'signin' | 'signup';

interface EmailAuthPanelProps {
  enabled: boolean;
  configurationError: string | null;
  mode: LandingAuthMode;
  isLoading: boolean;
  error: string | null;
  message: string | null;
  onModeChange: (mode: LandingAuthMode) => void;
  onAuthenticate: (email: string, password: string) => void;
}

export function EmailAuthPanel({
  enabled,
  configurationError,
  mode,
  isLoading,
  error,
  message,
  onModeChange,
  onAuthenticate,
}: EmailAuthPanelProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <section
      id="acceso"
      aria-labelledby="access-heading"
      className="border-y border-slate-200 bg-white"
    >
      <div className="mx-auto max-w-xl px-5 py-14 sm:px-8 md:py-18">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-teal-800">
            Tu espacio BridgeTalk
          </p>
          <h2
            id="access-heading"
            className="mt-2 text-2xl font-semibold tracking-tight"
          >
            {mode === 'signup' ? 'Crea tu cuenta' : 'Inicia sesión'}
          </h2>
          {configurationError ? (
            <p role="alert" className="mt-4 text-sm text-rose-800">
              {configurationError}
            </p>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                onAuthenticate(email.trim(), password);
              }}
            >
              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Correo electrónico
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700/20"
                />
              </div>
              <div>
                <label
                  htmlFor="auth-password"
                  className="mb-1.5 block text-sm font-medium text-slate-800"
                >
                  Contraseña
                </label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:border-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700/20"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Usa al menos 8 caracteres.
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-rose-800">
                  {error}
                </p>
              )}
              {message && (
                <p role="status" className="text-sm text-teal-900">
                  {message}
                </p>
              )}
              <button
                type="submit"
                disabled={!enabled || isLoading}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
              >
                {isLoading
                  ? 'Procesando…'
                  : mode === 'signup'
                    ? 'Crear cuenta'
                    : 'Iniciar sesión'}
              </button>
            </form>
          )}
          {enabled && !configurationError && (
            <p className="mt-5 text-center text-sm text-slate-600">
              {mode === 'signup'
                ? '¿Ya tienes una cuenta?'
                : '¿Aún no tienes cuenta?'}{' '}
              <button
                type="button"
                onClick={() =>
                  onModeChange(mode === 'signup' ? 'signin' : 'signup')
                }
                className="font-semibold text-teal-900 underline underline-offset-2"
              >
                {mode === 'signup' ? 'Inicia sesión' : 'Regístrate'}
              </button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
