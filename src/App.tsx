import { useEffect, useRef, useState } from 'react';
import { Dashboard } from './components/Dashboard.js';
import {
  LandingPage,
  type LandingAccessMode,
  type LandingAuthMode,
} from './components/LandingPage.js';
import { LearningModule } from './components/LearningModule.js';
import { TranslatorPanel } from './components/TranslatorPanel.js';
import {
  AudioStreamService,
  getAudioWebSocketUrl,
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
import { openPaddleCheckout } from './services/paddleCheckoutService.js';
import {
  isSupabaseConfigured,
  supabaseConfigurationError,
} from './services/supabaseConfig.js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

export default function App(): React.JSX.Element {
  const [accessPlan, setAccessPlan] = useState<
    'trial' | 'pro' | 'demo' | null
  >(null);
  const [authClient, setAuthClient] = useState<SupabaseClient | null>(null);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(!isSupabaseConfigured);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authMode, setAuthMode] = useState<LandingAuthMode>('signup');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [pendingProCheckout, setPendingProCheckout] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const paddleClientToken =
    import.meta.env.VITE_PADDLE_CLIENT_TOKEN?.trim() ?? '';
  const paddlePriceId = import.meta.env.VITE_PADDLE_PRICE_ID?.trim() ?? '';
  const landingAccessMode: LandingAccessMode = supabaseConfigurationError
    ? 'misconfigured'
    : !isSupabaseConfigured
      ? 'demo'
      : paddleClientToken && paddlePriceId
        ? 'paddle'
        : 'misconfigured';
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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsAuthReady(true);
      return;
    }

    let isCurrent = true;
    let unsubscribe: (() => void) | null = null;
    void import('./services/supabaseAuthService.js')
      .then(async ({ supabaseAuthClient }) => {
        if (!isCurrent) {
          return;
        }
        if (!supabaseAuthClient) {
          setIsAuthReady(true);
          return;
        }
        setAuthClient(supabaseAuthClient);
        const {
          data: { subscription },
        } = supabaseAuthClient.auth.onAuthStateChange((_event, session) => {
          if (!isCurrent) {
            return;
          }
          setAuthSession(session);
          if (!session) {
            setAccessPlan(null);
          }
        });
        unsubscribe = () => subscription.unsubscribe();
        const { data, error } = await supabaseAuthClient.auth.getSession();
        if (!isCurrent) {
          return;
        }
        if (error) {
          setAuthError('No se pudo restaurar la sesión. Inicia sesión de nuevo.');
        }
        setAuthSession(data.session);
        setAccessPlan(data.session ? 'trial' : null);
        setIsAuthReady(true);
      })
      .catch(() => {
        if (isCurrent) {
          setAuthError('No se pudo comprobar la sesión de Supabase.');
          setIsAuthReady(true);
        }
      });

    return () => {
      isCurrent = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(
    () => () => {
      learningSummaryRequestId.current += 1;
      void audioService.disconnect();
    },
    [audioService],
  );

  useEffect(() => {
    let isCurrent = true;
    if (accessPlan === null) {
      setIsLoadingAudioDevices(false);
      return () => {
        isCurrent = false;
      };
    }

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
  }, [accessPlan, audioDeviceRefreshKey]);

  function enterDashboard(plan: 'trial' | 'pro' | 'demo'): void {
    setCheckoutError(null);
    setAccessPlan(plan);
  }

  async function openProCheckout(session: Session): Promise<void> {
    setCheckoutError(null);
    if (landingAccessMode !== 'paddle') {
      setCheckoutError(
        'Configura Supabase y Paddle para habilitar una suscripción verificable.',
      );
      return;
    }
    const email = session.user.email;
    if (!email) {
      setCheckoutError(
        'La cuenta autenticada debe tener un correo para vincular la compra.',
      );
      return;
    }

    setIsCheckoutLoading(true);
    try {
      await openPaddleCheckout(
        paddleClientToken,
        paddlePriceId,
        { userId: session.user.id, email },
        () => {
          setAuthMessage(
            'Pago recibido. El servidor confirmará tu suscripción de forma segura.',
          );
          enterDashboard('trial');
        },
      );
    } catch (error: unknown) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : 'No se pudo abrir Paddle Checkout.',
      );
    } finally {
      setIsCheckoutLoading(false);
    }
  }

  async function subscribeToPro(): Promise<void> {
    setCheckoutError(null);
    if (!isSupabaseConfigured) {
      if (landingAccessMode === 'demo') {
        enterDashboard('pro');
      } else {
        setCheckoutError(
          'Configura Supabase antes de habilitar una suscripción real.',
        );
      }
      return;
    }
    if (landingAccessMode !== 'paddle') {
      setCheckoutError(
        'Configura VITE_PADDLE_CLIENT_TOKEN y VITE_PADDLE_PRICE_ID para habilitar el checkout.',
      );
      return;
    }
    if (!authSession) {
      setPendingProCheckout(true);
      setAuthMode('signin');
      setAuthMessage('Inicia sesión para continuar con la suscripción.');
      document.getElementById('acceso')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    await openProCheckout(authSession);
  }

  async function authenticate(
    email: string,
    password: string,
  ): Promise<void> {
    setAuthError(null);
    setAuthMessage(null);
    setIsAuthLoading(true);
    try {
      if (!authClient) {
        throw new Error(
          supabaseConfigurationError ?? 'Supabase Auth no está configurado.',
        );
      }

      const result =
        authMode === 'signup'
          ? await authClient.auth.signUp({ email, password })
          : await authClient.auth.signInWithPassword({
              email,
              password,
            });
      if (result.error) {
        throw result.error;
      }

      if (!result.data.session) {
        setAuthMessage(
          'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
        );
        return;
      }

      setAuthSession(result.data.session);
      if (pendingProCheckout) {
        setPendingProCheckout(false);
        await openProCheckout(result.data.session);
      } else {
        setAccessPlan('trial');
      }
    } catch (error: unknown) {
      setAuthError(
        error instanceof Error
          ? error.message
          : 'No se pudo completar la autenticación.',
      );
    } finally {
      setIsAuthLoading(false);
    }
  }

  function focusAuthForm(mode: LandingAuthMode): void {
    setAuthMode(mode);
    setAuthError(null);
    setAuthMessage(null);
    document.getElementById('acceso')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function signOut(): Promise<void> {
    setConnectionError(null);
    try {
      await audioService.disconnect();
      if (authClient) {
        const { error } = await authClient.auth.signOut();
        if (error) {
          throw error;
        }
      }
      setAuthSession(null);
      setAccessPlan(null);
    } catch (error: unknown) {
      setConnectionError(
        error instanceof Error
          ? error.message
          : 'No se pudo cerrar la sesión.',
      );
    }
  }

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
        ...(authSession?.access_token
          ? { accessToken: authSession.access_token }
          : {}),
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
      const summary = await fetchLearningSummary(
        sessionId,
        authSession?.access_token,
      );
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
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token
            ? { Authorization: `Bearer ${authSession.access_token}` }
            : {}),
        },
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

  if (accessPlan === null) {
    if (isSupabaseConfigured && !isAuthReady) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 text-sm text-slate-600">
          <p role="status">Comprobando tu sesión…</p>
        </main>
      );
    }

    return (
      <LandingPage
        accessMode={landingAccessMode}
        authEnabled={isSupabaseConfigured}
        authConfigurationError={supabaseConfigurationError}
        authMode={authMode}
        isAuthLoading={isAuthLoading}
        authError={authError}
        authMessage={authMessage}
        isCheckoutLoading={isCheckoutLoading}
        checkoutError={checkoutError}
        onSignIn={() =>
          isSupabaseConfigured || supabaseConfigurationError
            ? focusAuthForm('signin')
            : enterDashboard('demo')
        }
        onAuthModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
          setAuthMessage(null);
        }}
        onAuthenticate={(email, password) =>
          void authenticate(email, password)
        }
        onStartTrial={() =>
          isSupabaseConfigured || supabaseConfigurationError
            ? focusAuthForm('signup')
            : enterDashboard('trial')
        }
        onSubscribe={() => void subscribeToPro()}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {authSession && (
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Sesión iniciada como{' '}
              <span className="font-medium text-slate-900">
                {authSession.user.email ?? 'usuario BridgeTalk'}
              </span>
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="min-h-10 self-start rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-teal-700 hover:text-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 sm:self-auto"
            >
              Cerrar sesión
            </button>
          </div>
        )}
        <Dashboard
          userId={authSession?.user.id ?? 'demo-local'}
          accessToken={authSession?.access_token ?? null}
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
