export const QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED — rerun after the daily reset';

/**
 * What a run does when its Gemini quota is spent: say QUOTA_EXHAUSTED in the log and in the job
 * summary, clean up (best effort, five seconds at most), and exit with 3. It acts once.
 */
export function createQuotaStop({
  title,
  error = (line) => console.error(line),
  summary,
  cleanup,
  exit = (code) => process.exit(code),
}: {
  title: string;
  error?: (line: string) => void;
  summary: (markdown: string) => void;
  cleanup: () => Promise<unknown> | undefined;
  exit?: (code: number) => void;
}): (reason: string) => void {
  let stopping = false;
  return (reason) => {
    if (stopping) return;
    stopping = true;
    error(`::error title=QUOTA_EXHAUSTED::${QUOTA_EXHAUSTED}. ${reason}.`);
    summary(
      `### ${title}: ${QUOTA_EXHAUSTED}\n\nStopped: ${reason}. The eval project's free Gemini quota resets daily. See docs/runbook.md, "QUOTA_EXHAUSTED".\n`,
    );
    void Promise.race([cleanup(), new Promise((res) => setTimeout(res, 5000))]).finally(() =>
      exit(3),
    );
  };
}
