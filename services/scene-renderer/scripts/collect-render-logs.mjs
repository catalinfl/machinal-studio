import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [outputDirectory, ...containers] = process.argv.slice(2);
if (!outputDirectory || !containers.length || containers.some(name => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))) {
  throw new Error('Usage: node collect-render-logs.mjs NEW_DIRECTORY CONTAINER [CONTAINER...]');
}
const output = resolve(outputDirectory);
await mkdir(output, { recursive: false });
for (const container of containers) {
  const result = spawnSync('docker', ['logs', '--timestamps', '--tail', '3000', container], { maxBuffer: 32 * 1024 ** 2, windowsHide: true });
  if (result.error) throw result.error;
  await writeFile(join(output, `${container}.stdout.log`), result.stdout, { flag: 'wx' });
  await writeFile(join(output, `${container}.stderr.log`), result.stderr, { flag: 'wx' });
  if (result.status !== 0) throw new Error(`docker logs failed for ${container}; see saved stderr`);
  console.info(`Saved ${container} stdout/stderr in ${output}`);
}
