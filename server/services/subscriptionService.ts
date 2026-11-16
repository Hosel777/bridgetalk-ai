import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SubscriptionPlan = 'free_trial' | 'pro';

export interface SubscriptionProfile {
  id: string;
  email: string;
  plan: SubscriptionPlan;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  minutes_used: number;
  minutes_limit: number;
}

export interface PaddleActivation {
  userId: string;
  email: string | null;
  customerId: string;
  subscriptionId: string | null;
}

export interface AuthenticatedAudioUser {
  id: string;
  email: string | null;
}

export interface SubscriptionService {
  readonly isPersistent: boolean;
  authenticateAudioUser(accessToken: string | null): Promise<AuthenticatedAudioUser | null>;
  canUseAudioStream(userId: string): Promise<boolean>;
  getProfile(userId: string): Promise<SubscriptionProfile | null>;
  recordConsumedMinutes(userId: string, durationSeconds: number): Promise<void>;
  activateProForPaddle(activation: PaddleActivation): Promise<boolean>;
}

export interface SubscriptionServiceOptions {
  env?: NodeJS.ProcessEnv;
  initialProfiles?: readonly SubscriptionProfile[];
}

interface SubscriptionStore {
  readonly isPersistent: boolean;
  authenticateAudioUser(
    accessToken: string | null,
  ): Promise<AuthenticatedAudioUser | null>;
  getProfile(userId: string): Promise<SubscriptionProfile | null>;
  recordMinutes(userId: string, minutes: number): Promise<void>;
  activatePro(activation: PaddleActivation): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readProfile(value: unknown): SubscriptionProfile | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.email !== 'string' ||
    (value.plan !== 'free_trial' && value.plan !== 'pro') ||
    (typeof value.paddle_customer_id !== 'string' &&
      value.paddle_customer_id !== null) ||
    (typeof value.paddle_subscription_id !== 'string' &&
      value.paddle_subscription_id !== null) ||
    typeof value.minutes_used !== 'number' ||
    !Number.isInteger(value.minutes_used) ||
    typeof value.minutes_limit !== 'number' ||
    !Number.isInteger(value.minutes_limit)
  ) {
    return null;
  }

  return {
    id: value.id,
    email: value.email,
    plan: value.plan,
    paddle_customer_id: value.paddle_customer_id,
    paddle_subscription_id: value.paddle_subscription_id,
    minutes_used: value.minutes_used,
    minutes_limit: value.minutes_limit,
  };
}

function createDefaultProfile(userId: string): SubscriptionProfile {
  return {
    id: userId,
    email: '',
    plan: 'free_trial',
    paddle_customer_id: null,
    paddle_subscription_id: null,
    minutes_used: 0,
    minutes_limit: 15,
  };
}

class MemorySubscriptionStore implements SubscriptionStore {
  readonly isPersistent = false;
  private readonly profiles = new Map<string, SubscriptionProfile>();

  constructor(initialProfiles: readonly SubscriptionProfile[]) {
    for (const profile of initialProfiles) {
      this.profiles.set(profile.id, { ...profile });
    }
  }

  async authenticateAudioUser(): Promise<AuthenticatedAudioUser> {
    return { id: 'demo-local', email: null };
  }

  async getProfile(userId: string): Promise<SubscriptionProfile> {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = createDefaultProfile(userId);
      this.profiles.set(userId, profile);
    }
    return { ...profile };
  }

  async recordMinutes(userId: string, minutes: number): Promise<void> {
    const profile = await this.getProfile(userId);
    profile.minutes_used += minutes;
    this.profiles.set(userId, profile);
  }

  async activatePro(activation: PaddleActivation): Promise<boolean> {
    const profile = await this.getProfile(activation.userId);
    const emailMatches =
      activation.email !== null &&
      profile.email.toLowerCase() === activation.email.toLowerCase();
    const existingCustomerMatches =
      activation.email === null &&
      profile.paddle_customer_id === activation.customerId;
    if (!emailMatches && !existingCustomerMatches) {
      return false;
    }

    profile.plan = 'pro';
    profile.minutes_limit = 900;
    profile.paddle_customer_id = activation.customerId;
    profile.paddle_subscription_id = activation.subscriptionId;
    this.profiles.set(profile.id, profile);
    return true;
  }
}

class SupabaseSubscriptionStore implements SubscriptionStore {
  readonly isPersistent = true;

  constructor(private readonly client: SupabaseClient) {}

  async authenticateAudioUser(
    accessToken: string | null,
  ): Promise<AuthenticatedAudioUser | null> {
    if (!accessToken) {
      return null;
    }

    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) {
      return null;
    }
    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  }

  async getProfile(userId: string): Promise<SubscriptionProfile | null> {
    const { data, error } = await this.client
      .from('user_profiles')
      .select(
        'id, email, plan, paddle_customer_id, paddle_subscription_id, minutes_used, minutes_limit',
      )
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not read the user's subscription profile: ${error.message}`);
    }
    if (data === null) {
      return null;
    }

    const profile = readProfile(data);
    if (!profile) {
      throw new Error('Supabase returned an invalid subscription profile.');
    }
    return profile;
  }

  async recordMinutes(userId: string, minutes: number): Promise<void> {
    const { error } = await this.client.rpc('record_audio_minutes', {
      p_user_id: userId,
      p_minutes: minutes,
    });
    if (error) {
      throw new Error(`Could not record audio usage: ${error.message}`);
    }
  }

  async activatePro(activation: PaddleActivation): Promise<boolean> {
    const { data, error } = await this.client.rpc('activate_pro_for_paddle', {
      p_user_id: activation.userId,
      p_email: activation.email,
      p_customer_id: activation.customerId,
      p_subscription_id: activation.subscriptionId,
    });
    if (error) {
      throw new Error(`Could not activate the Paddle subscription: ${error.message}`);
    }
    return data === true;
  }
}

function createStore(options: SubscriptionServiceOptions): SubscriptionStore {
  const env = options.env ?? process.env;
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (Boolean(url) !== Boolean(serviceRoleKey)) {
    throw new Error(
      'Configure both VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or leave both empty.',
    );
  }

  if (!url || !serviceRoleKey) {
    return new MemorySubscriptionStore(options.initialProfiles ?? []);
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseSubscriptionStore(client);
}

export function createSubscriptionService(
  options: SubscriptionServiceOptions = {},
): SubscriptionService {
  const store = createStore(options);

  return {
    isPersistent: store.isPersistent,
    authenticateAudioUser: (accessToken) =>
      store.authenticateAudioUser(accessToken),
    getProfile: async (userId) => {
      if (!userId.trim()) {
        throw new Error('A user ID is required to read subscription usage.');
      }
      return store.getProfile(userId);
    },
    canUseAudioStream: async (userId) => {
      const profile = await store.getProfile(userId);
      if (!profile) {
        throw new Error('The authenticated user has no subscription profile.');
      }
      return profile.minutes_used < profile.minutes_limit;
    },
    recordConsumedMinutes: async (userId, durationSeconds) => {
      if (!userId.trim()) {
        throw new Error('A user ID is required to record audio usage.');
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
        throw new Error('Session duration must be a non-negative number.');
      }
      const minutes = Math.ceil(durationSeconds / 60);
      if (minutes > 0) {
        await store.recordMinutes(userId, minutes);
      }
    },
    activateProForPaddle: async (activation) => {
      if (
        !activation.userId.trim() ||
        (activation.email !== null && !activation.email.trim()) ||
        !activation.customerId.trim()
      ) {
        throw new Error('Paddle activation requires a user, email, and customer ID.');
      }
      return store.activatePro(activation);
    },
  };
}
