import { GoogleGenAI } from '@google/genai';

// Run by `npm run ai:models`: lists the models the GEMINI_API_KEY can use, so model names are
// read from the provider and never typed from memory. Prints names and abilities, never the key.
const apiKey = process.env['GEMINI_API_KEY'];
if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

const ai = new GoogleGenAI({ apiKey });
const rows: { name: string; actions: string[]; inputTokens: number | undefined }[] = [];
for await (const model of await ai.models.list({ config: { pageSize: 100 } })) {
  rows.push({
    name: (model.name ?? '').replace(/^models\//, ''),
    actions: model.supportedActions ?? [],
    inputTokens: model.inputTokenLimit,
  });
}

const show = (title: string, action: string) => {
  console.log(`\n${title}`);
  for (const r of rows
    .filter((x) => x.actions.includes(action))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${r.name}  (in: ${r.inputTokens ?? '?'} tokens)`);
  }
};
show('Text generation (generateContent)', 'generateContent');
show('Embeddings (embedContent)', 'embedContent');
