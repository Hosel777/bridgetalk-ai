import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl, isSupabaseConfigured } from './supabaseConfig.js';

export const supabaseAuthClient: SupabaseClient | null =
  isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: false,
          detectSessionInUrl: true,
        },
      })
    : null;
