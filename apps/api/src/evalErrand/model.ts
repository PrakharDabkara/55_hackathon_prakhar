export const PRIMARY_DEFAULT = 'gemini-3.1-flash-lite';
export const FALLBACK_DEFAULT = 'gemini-3.5-flash-lite';

/**
 * The environment of an agent eval run. "primary" and "fallback" name the model the errand agent
 * runs on, so they map to GEMINI_ERRAND_MODEL; GEMINI_MODEL (query resolution) is left as it is,
 * as in production. Every automatic fallback is off, so a run measures one model.
 */
export function errandEvalEnv(
  env: Record<string, string | undefined>,
  which: 'primary' | 'fallback',
): Record<string, string | undefined> {
  const chosen =
    which === 'fallback'
      ? (env['GEMINI_FALLBACK_MODEL'] ?? FALLBACK_DEFAULT)
      : (env['GEMINI_MODEL'] ?? PRIMARY_DEFAULT);
  const out: Record<string, string | undefined> = { ...env, GEMINI_ERRAND_MODEL: chosen };
  delete out['GEMINI_FALLBACK_MODEL'];
  delete out['GEMINI_ERRAND_FALLBACK_MODEL'];
  return out;
}
