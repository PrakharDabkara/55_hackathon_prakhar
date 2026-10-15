/** Polls `read` until `done` accepts the value or the time runs out; returns the last value. */
export async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 15_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
