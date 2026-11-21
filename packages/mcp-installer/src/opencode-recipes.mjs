import { createHash } from 'node:crypto';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, basename } from 'node:path';

const maxRecipeBytes = 2 * 1024 * 1024;
const recipeTools = ['validate_recipe', 'compile_recipe', 'generate_assets', 'render_video'];

function recipePath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !/\.edit\.ya?ml$/i.test(path)) {
    throw new Error('Use an absolute client-local .edit.yaml path. This transfers recipe text only, not local media.');
  }
  return path;
}

export async function filePermission(ctx, context, action, path) {
  await ctx.permission.assert({
    sessionID: context.sessionID, agent: context.agent,
    source: { type: 'tool', messageID: context.messageID, id: context.id },
    action, resources: [path], save: [path],
  });
}

export async function readBoundedUTF8(path, signal) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Recipe must be a regular file, not a symbolic link.');
  const file = await open(path, 'r');
  try {
    const actual = await file.stat();
    if (!actual.isFile() || actual.size > maxRecipeBytes || actual.ino !== info.ino || actual.dev !== info.dev) throw new Error('Recipe changed or exceeds the 2 MiB limit.');
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(maxRecipeBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxRecipeBytes) throw new Error('Recipe exceeds the 2 MiB limit.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } finally { await file.close(); }
}

export function resultJSON(result) {
  if (result.output && typeof result.output === 'object') return result.output;
  const content = typeof result.content === 'string' ? result.content
    : result.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
  try { return JSON.parse(content); } catch { return undefined; }
}

export async function saveUTF8(path, recipe, signal) {
  const bytes = Buffer.from(recipe, 'utf8');
  if (bytes.length > maxRecipeBytes) throw new Error('Resolved recipe exceeds the 2 MiB limit.');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes, { signal }); }
  catch (error) { await file.close(); await unlink(path); throw error; }
  await file.close();
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function installRecipeFiles(ctx, servers) {
  const names = [...servers];
  await ctx.tool.transform(editor => {
    for (const server of names) {
      for (const name of recipeTools) {
        editor.update(`${server}_${name}`.replace(/[^a-z\d_-]/gi, '_'), tool => {
          const original = tool.execute;
          tool.input = { ...tool.input,
            required: (tool.input.required ?? []).filter(key => key !== 'composition'),
            properties: { ...tool.input.properties,
              compositionFile: { type: 'string', description: 'Absolute client-local .edit.yaml to send verbatim as UTF-8 instead of composition or sourceJobId. Uses host file permission and the original MCP executor; no local media upload.' },
              ...(['validate_recipe', 'compile_recipe'].includes(name) ? {
                captionBaselineRecipeFile: { type: 'string', description: 'Intact resolved baseline .edit.yaml for complete caption comparison. With authorized captionTextEdits, verifies only those exact text replacements and preserves every timing, ID, cue and style.' },
              } : {}),
            },
          };
          tool.description += ' OpenCode: use compositionFile to submit a local recipe without copying/retyping it into tool arguments. Existing consent, validation, idempotency and spending rules still apply.';
          tool.execute = async (input, context) => {
            const { compositionFile, captionBaselineRecipeFile, ...args } = input;
            if (captionBaselineRecipeFile !== undefined) {
              if (!['validate_recipe', 'compile_recipe'].includes(name) || args.captionBaseline !== undefined) throw new Error('Use one caption baseline source on free recipe preflight only.');
              args.captionBaseline = await readRecipe(ctx, context, captionBaselineRecipeFile);
            }
            if (compositionFile !== undefined) {
              if (args.composition !== undefined || args.sourceJobId !== undefined) throw new Error('Choose compositionFile, composition or sourceJobId, not multiple recipe sources.');
              args.composition = await readRecipe(ctx, context, compositionFile);
            }
            return original(args, context);
          };
        });
      }
      editor.update(`${server}_get_job_result`.replace(/[^a-z\d_-]/gi, '_'), tool => {
        const original = tool.execute;
        tool.input = { ...tool.input, properties: { ...tool.input.properties,
          recipeFile: { type: 'string', description: 'Optional absolute new .edit.yaml path. Save returned resolved recipe verbatim in UTF-8, without overwriting, and return a compact receipt. No media download.' },
        } };
        tool.description += ' OpenCode: recipeFile saves resolved YAML directly to a new local file; patch it and submit with compositionFile. No manual JSON/YAML conversion, compression or repeated result retrieval is needed.';
        tool.execute = async (input, context) => {
          const { recipeFile, ...args } = input;
          if (recipeFile === undefined) return original(args, context);
          const path = recipePath(recipeFile);
          await filePermission(ctx, context, 'edit', path);
          const canonical = join(await realpath(dirname(path)), basename(path));
          if (canonical !== path) await filePermission(ctx, context, 'edit', canonical);
          const result = await original(args, context);
          const output = resultJSON(result);
          const data = output?.data;
          if (typeof data?.recipeYaml !== 'string') return result;
          let receipt;
          try { receipt = await saveUTF8(canonical, data.recipeYaml, context.signal); }
          catch (error) {
            // Keep the intact result available if local saving fails; never rerun generation to recover text.
            return { ...result, metadata: { ...result.metadata, recipeFileError: error.code === 'EEXIST' ? 'Destination exists; no overwrite. Use the returned YAML or a new filename.' : 'Could not save the recipe. Use the intact returned YAML; no generation was repeated.' } };
          }
          const { recipeYaml: _recipe, ...summary } = data;
          const saved = { ...output, data: { ...summary, recipeFile: receipt } };
          return { ...result, ...(result.output === undefined ? {} : { output: saved }), content: JSON.stringify(saved) };
        };
      });
    }
  });
}

async function readRecipe(ctx, context, file) {
  const path = recipePath(file);
  await filePermission(ctx, context, 'read', path);
  const canonical = await realpath(path);
  if (canonical !== path) await filePermission(ctx, context, 'read', canonical);
  return readBoundedUTF8(path, context.signal);
}
