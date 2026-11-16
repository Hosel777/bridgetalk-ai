const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const supabaseConfigurationError =
  Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)
    ? 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY juntos.'
    : null;

export const isSupabaseConfigured =
  Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

export { supabaseAnonKey, supabaseUrl };
