import { sanitiseMessage } from './modules/ai/failure.js';
import { createGeminiProvider } from './modules/ai/gemini.js';
import { buildResolvePrompt, resolveAnswerSchema } from './modules/ai/resolvePrompt.js';

// Run by `npm run ai:bench` through scripts/probe/ai-bench.sh (round 3 C-16a): the same short
// resolve call with the model's own thinking and with the minimal setting, on each model, N times
// each, one after another. Prints p50, p95 and the output tokens billed. The key comes only from
// GEMINI_BENCH_KEY, which the script sets after reading it without showing it; this file reads no
// settings file and not GEMINI_API_KEY. Sends a fixed catalog sample and fixed words, no user data.
const apiKey = process.env['GEMINI_BENCH_KEY'];
if (!apiKey) throw new Error('run it with npm run ai:bench (it asks for the evals key)');
const primary = process.env['GEMINI_MODEL'] ?? 'gemini-3.1-flash-lite';
const fallback = process.env['GEMINI_FALLBACK_MODEL'] ?? '';
const rounds = Number(process.env['BENCH_ROUNDS'] ?? 20);

const candidates = [
  { id: 'i1', nameEn: 'Rice', nameHi: 'चावल', category: 'grocery' },
  { id: 'i2', nameEn: 'Basmati rice', nameHi: 'बासमती चावल', category: 'grocery' },
  { id: 'i3', nameEn: 'Artificial rose', nameHi: 'नकली गुलाब', category: 'gifts' },
  { id: 'i4', nameEn: 'Ball pen', nameHi: 'बॉल पेन', category: 'stationery' },
];
const queries = ['chawal', 'fake rose', 'pen', 'basmati', 'rose'];

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

for (const model of [primary, fallback].filter(Boolean)) {
  for (const thinking of ['model_default', 'minimal'] as const) {
    const provider = createGeminiProvider({
      apiKey,
      model,
      embedModel: 'gemini-embedding-001',
      embedDim: 768,
      thinking,
    });
    const times: number[] = [];
    let out = 0;
    let failed = 0;
    for (let i = 0; i < rounds; i++) {
      const q = queries[i % queries.length] as string;
      const prompt = buildResolvePrompt(q, candidates);
      const started = Date.now();
      try {
        const r = await provider.generateJson({
          ...prompt,
          schema: resolveAnswerSchema,
          maxOutputTokens: 400,
          purpose: 'resolve_query',
        });
        out += r.usage.outputTokens;
        times.push(Date.now() - started);
      } catch (error) {
        failed++;
        console.error(
          `  ${model} ${thinking} call ${i + 1}: ${sanitiseMessage((error as Error).message)}`,
        );
      }
    }
    times.sort((a, b) => a - b);
    console.log(
      `${model.padEnd(28)} ${thinking.padEnd(14)} ok ${times.length}/${rounds}  p50 ${percentile(times, 50)} ms  p95 ${percentile(times, 95)} ms  output tokens/call ${times.length ? Math.round(out / times.length) : 0}${failed ? `  failed ${failed}` : ''}`,
    );
  }
}
