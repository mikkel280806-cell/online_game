// Public client config. The publishable key is designed to ship in the browser;
// row-level security on the database decides what it can do.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://cwkynbkytsfhpocapcsk.supabase.co';
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_vdcmB7JfjHnitz4VySFY-g_ThOgXyvG';

export const BUILD_VERSION: string = import.meta.env.VITE_BUILD_VERSION ?? 'dev';

/** Network tick for sending own player state (Hz). */
export const NET_SEND_HZ = 20;
/** Remote players are rendered this far in the past to smooth jitter (ms). */
export const NET_INTERP_DELAY_MS = 100;
