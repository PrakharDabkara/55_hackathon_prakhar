// PostToolUse (Edit|Write): runs Prettier on the file that was just edited, if Prettier handles it.
// Never fails the tool call: always exit 0, and says nothing unless something went wrong.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readInput } from './lib.mjs';

try {
  const input = await readInput();
  const file = input?.tool_input?.file_path;
  if (typeof file === 'string' && file) {
    const prettier = await import('prettier');
    const ignorePath = join(input.cwd || process.cwd(), '.prettierignore');
    const info = await prettier.getFileInfo(file, { ignorePath });
    if (!info.ignored && info.inferredParser) {
      const source = await readFile(file, 'utf8');
      const config = (await prettier.resolveConfig(file)) ?? {};
      const formatted = await prettier.format(source, { ...config, filepath: file });
      if (formatted !== source) await writeFile(file, formatted);
    }
  }
} catch (error) {
  process.stderr.write(`format: Prettier skipped the file (${error?.message?.split('\n')[0]}).\n`);
}
process.exit(0);
