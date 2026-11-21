import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { filePermission, readBoundedUTF8, resultJSON, saveUTF8 } from './opencode-recipes.mjs';

const preflightTools = ['validate_recipe', 'compile_recipe'];
const freeTools = [...preflightTools, 'get_job_result'];
const paidTools = ['render_video', 'generate_assets'];
const versionPattern = /^sha256:[a-f0-9]{64}$/;

async function checkpointPath(ctx, context, path, action) {
  if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.checkpoint.json')) throw new Error('Use an absolute client-local .checkpoint.json path.');
  await filePermission(ctx, context, action, path);
  if (action === 'read' && (await lstat(path)).isSymbolicLink()) throw new Error('Checkpoint must be a regular file, not a symbolic link.');
  const canonical = action === 'read' ? await realpath(path) : join(await realpath(dirname(path)), basename(path));
  if (canonical !== path) await filePermission(ctx, context, action, canonical);
  return canonical;
}

async function readCheckpoint(ctx, context, path, projectId) {
  const canonical = await checkpointPath(ctx, context, path, 'read');
  const checkpoint = JSON.parse(await readBoundedUTF8(canonical, context.signal));
  if (checkpoint.version !== 1 || checkpoint.projectId !== projectId || !versionPattern.test(checkpoint.compositionVersion)) throw new Error('Checkpoint is invalid or belongs to another project.');
  return checkpoint;
}

function checkpointData(output, input, operation) {
  const data = output?.data;
  if (output?.statusCode !== 200 || !versionPattern.test(data?.compositionVersion)) return;
  const { compositionVersion, captionVersion, diagnostics = [], requirements = [], productionReview, editorialReview, captionReview } = data;
  if (!Array.isArray(diagnostics) || !Array.isArray(requirements)) return;
  const valid = diagnostics.every(item => item?.severity !== 'error');
  return { version: 1, operation, projectId: input.projectId, ...(input.jobId ? { jobId: input.jobId } : {}),
    compositionVersion, ...(versionPattern.test(captionVersion) ? { captionVersion } : {}),
    valid, ready: valid && requirements.length === 0,
    diagnostics, requirements, ...(productionReview ? { productionReview } : {}), ...(editorialReview ? { editorialReview } : {}),
    ...(captionReview ? { captionReview } : {}),
    visualInspection: false,
  };
}

export async function installCheckpoints(ctx, servers) {
  const names = [...servers];
  await ctx.tool.transform(editor => {
    for (const server of names) {
      for (const name of [...freeTools, ...paidTools]) {
        editor.update(`${server}_${name}`.replace(/[^a-z\d_-]/gi, '_'), tool => {
          const original = tool.execute;
          const paid = paidTools.includes(name);
          tool.input = { ...tool.input, properties: { ...tool.input.properties,
            checkpointFile: { type: 'string', description: paid
              ? 'Optional saved .checkpoint.json from free preflight. Read with host permission and apply its exact compositionVersion as the server stale-review guard; never creates spending consent.'
              : 'Optional absolute new .checkpoint.json. Save compact versions, project/job IDs and diagnostics for deterministic recovery; never overwrite.' },
            ...(name === 'get_job_result' ? {} : { captionBaselineFile: { type: 'string', description: 'Optional .checkpoint.json from the resolved baseline. Apply its captionVersion before submission to detect any changed text entry or caption resultTextIds. Omit only for authorized text edits.' } }),
          } };
          tool.execute = async (input, context) => {
            const { checkpointFile, captionBaselineFile, ...args } = input;
            if (captionBaselineFile !== undefined) {
              const baseline = await readCheckpoint(ctx, context, captionBaselineFile, args.projectId);
              if (!versionPattern.test(baseline.captionVersion)) throw new Error('Baseline has no text/caption fingerprint. Retrieve the existing resolved result; never regenerate it.');
              if (args.expectedCaptionVersion !== undefined && args.expectedCaptionVersion !== baseline.captionVersion) throw new Error('Conflicting caption baseline versions.');
              args.expectedCaptionVersion = baseline.captionVersion;
            }
            let destination;
            if (checkpointFile !== undefined) {
              if (paid) {
                const checkpoint = await readCheckpoint(ctx, context, checkpointFile, args.projectId);
                const render = name === 'render_video';
                if (!(render ? checkpoint.ready : checkpoint.valid) || !preflightTools.includes(checkpoint.operation) || render && ['revision_required', 'not_ready'].includes(checkpoint.productionReview?.status)) throw new Error('Checkpoint has unresolved preflight/review findings. Repair and save a new free preflight; no paid action was submitted.');
                if (args.expectedCompositionVersion !== undefined && args.expectedCompositionVersion !== checkpoint.compositionVersion) throw new Error('Conflicting composition checkpoint versions.');
                args.expectedCompositionVersion = checkpoint.compositionVersion;
              } else destination = await checkpointPath(ctx, context, checkpointFile, 'edit');
            }
            const result = await original(args, context);
            if (!destination) return result;
            const output = resultJSON(result);
            const checkpoint = checkpointData(output, args, name);
            if (!checkpoint) return result;
            try {
              const receipt = await saveUTF8(destination, JSON.stringify(checkpoint, null, 2) + '\n', context.signal);
              const saved = { ...output, data: { ...output.data, checkpointFile: receipt } };
              return { ...result, ...(result.output === undefined ? {} : { output: saved }), content: JSON.stringify(saved) };
            } catch (error) {
              return { ...result, metadata: { ...result.metadata, checkpointFileError: error.code === 'EEXIST' ? 'Checkpoint exists; no overwrite. Keep this result or choose a new checkpoint filename.' : 'Checkpoint saving failed; retain this intact result. No operation was repeated.' } };
            }
          };
        });
      }
    }
  });
}
