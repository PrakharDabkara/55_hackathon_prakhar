/**
 * Runs one eval case, and tries it again when a model call failed during the attempt.
 * Failures are counted per attempt: a retry that goes through is not an error, even though the
 * running total of failed calls never goes down.
 */
export const runWithRetries = async <T>(
  attempt: () => Promise<T>,
  failedCount: () => Promise<number>,
  maxRetries: number,
  pause: (ms: number) => Promise<void>,
  onRetry: () => void = () => {},
  pauseMs = 0,
): Promise<{ value: T; errored: boolean }> => {
  let before = await failedCount();
  let value = await attempt();
  for (let n = 1; (await failedCount()) > before; n++) {
    if (n > maxRetries) return { value, errored: true };
    onRetry();
    await pause(pauseMs * n);
    before = await failedCount();
    value = await attempt();
  }
  return { value, errored: false };
};
