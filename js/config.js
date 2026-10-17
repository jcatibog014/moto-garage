// Supabase connection. Find both values in the Supabase dashboard under
// Project Settings -> API. The anon (public) key is meant to be used in the
// browser; row level security in supabase/schema.sql protects the data.
window.MOTO_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
};
