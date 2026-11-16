const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

interface PaddleEvent {
  name: string;
}

interface PaddleSdk {
  Environment: {
    set(environment: 'sandbox' | 'production'): void;
  };
  Initialize(options: {
    token: string;
    eventCallback: (event: PaddleEvent) => void;
  }): void;
  Checkout: {
    open(options: {
      items: Array<{ priceId: string; quantity: number }>;
      settings: { locale: string };
      customData: { user_id: string };
      customer: { email: string };
    }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleSdk;
  }
}

let paddleScriptPromise: Promise<PaddleSdk> | null = null;
let initializedClientToken: string | null = null;

function loadPaddleSdk(): Promise<PaddleSdk> {
  if (window.Paddle) {
    return Promise.resolve(window.Paddle);
  }
  if (paddleScriptPromise) {
    return paddleScriptPromise;
  }

  paddleScriptPromise = new Promise<PaddleSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_SCRIPT_URL;
    script.async = true;
    script.addEventListener(
      'load',
      () => {
        if (window.Paddle) {
          resolve(window.Paddle);
        } else {
          reject(new Error('Paddle Checkout no se inicializó correctamente.'));
        }
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error('No se pudo cargar Paddle Checkout.')),
      { once: true },
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    paddleScriptPromise = null;
    throw error;
  });

  return paddleScriptPromise;
}

export async function openPaddleCheckout(
  clientToken: string,
  priceId: string,
  customer: { userId: string; email: string },
  onCheckoutCompleted: () => void,
): Promise<void> {
  const token = clientToken.trim();
  const configuredPriceId = priceId.trim();
  if (!token || !configuredPriceId || !customer.userId || !customer.email) {
    throw new Error('Configura el checkout y una cuenta autenticada de BridgeTalk.');
  }

  const paddle = await loadPaddleSdk();
  if (initializedClientToken && initializedClientToken !== token) {
    throw new Error('Paddle ya se inicializó con otro token en esta página.');
  }
  if (!initializedClientToken) {
    if (token.startsWith('test_')) {
      paddle.Environment.set('sandbox');
    }
    paddle.Initialize({
      token,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          onCheckoutCompleted();
        }
      },
    });
    initializedClientToken = token;
  }

  paddle.Checkout.open({
    items: [{ priceId: configuredPriceId, quantity: 1 }],
    settings: { locale: 'es' },
    customData: { user_id: customer.userId },
    customer: { email: customer.email },
  });
}
