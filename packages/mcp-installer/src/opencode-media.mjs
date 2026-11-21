import { join } from 'node:path';
import { assertNewDownload, downloadDirectory, downloadFilename, saveDownload } from './download.mjs';
import { readTransferJSON, requestTransfer, transferURL, TransferError } from './transfer-http.mjs';

const projectPattern = /^[a-z\d_-]{1,64}$/i;
const jobPattern = /^[a-f\d]{32}$/;
const renderKinds = new Set(['automation-render', 'render', 'editor-render']);

function projectPath(input) {
  if (!projectPattern.test(input.projectId ?? '')) throw new TransferError('Use a projectId returned by list_projects or create_project.');
  return `/v1/projects/${input.projectId}`;
}

export function validateDownload(input) {
  if (input.userApproved !== true) throw new TransferError('Ask for approval to download the named file to the chosen client directory first.');
  if (input.filename !== undefined) downloadFilename(input.filename);
  if (input.url) {
    if (input.projectId || input.jobId || input.file || input.storage || input.server) {
      throw new TransferError('Choose either a public internet URL or an owned project file/job, not both.');
    }
    transferURL(input.url);
    if (!input.directory || !input.filename) throw new TransferError('Internet downloads require an approved directory and filename.');
    return;
  }
  projectPath(input);
  if (Boolean(input.jobId) === Boolean(input.file)) throw new TransferError('Choose one completed jobId or one exact project filename.');
  if (input.jobId && (!jobPattern.test(input.jobId) || input.storage)) throw new TransferError('Use a returned jobId; storage applies only to existing media files.');
  if (input.file) downloadFilename(input.file);
  if (input.storage && !['s3', 'volume'].includes(input.storage)) throw new TransferError('Copy storage=s3 or volume from the approved media listing.');
}

export function projectAPI(connection, signal, request = requestTransfer) {
  const origin = new URL(connection.endpoint).origin;
  return async (path, body) => {
    const response = await request(new URL(path, origin), {
      trustedOrigin: origin, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)].filter(Boolean)),
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${connection.key}`, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new TransferError(`The machinal API request failed (HTTP ${response.statusCode}). Redirects are refused; no credentials were forwarded.`);
    }
    return readTransferJSON(response);
  };
}

async function projectSource(input, connection, signal, request) {
  const api = projectAPI(connection, signal, request);
  const root = projectPath(input);
  let filename = input.file;
  if (input.jobId) {
    const job = await api(`${root}/jobs/${input.jobId}?view=summary`);
    if (job.status !== 'completed' || !renderKinds.has(job.kind)) {
      throw new TransferError('This job is not a completed video/audio render. Wait for completion of the same job; do not render again.');
    }
    filename = downloadFilename(job.filename);
  }
  let directory = input.directory;
  if (!directory) directory = (await api('/v1/preferences/downloads')).directory;
  if (!directory) throw new TransferError('No client-local download directory is set. Ask the user where to save the file.');
  return {
    directory, filename: input.filename ?? filename,
    async delivery() {
      const descriptor = await api(`${root}/media/delivery-links`, { file: filename, storage: input.storage ?? 's3' });
      const origin = new URL(connection.endpoint).origin;
      const url = transferURL(descriptor.url, origin);
      if (url.origin !== origin || !/^\/deliveries\/[a-z\d_-]{32,}$/i.test(url.pathname) || url.search) {
        throw new TransferError('The API returned an invalid delivery descriptor. No file was downloaded.');
      }
      return { url, trustedOrigin: origin };
    },
  };
}

function permission(ctx, context, action, resources) {
  return ctx.permission.assert({
    sessionID: context.sessionID, agent: context.agent,
    source: { type: 'tool', messageID: context.messageID, id: context.id },
    action, resources, save: resources,
  });
}

export async function installOpenCodeMedia(ctx, { getConnection, signal: lifetime, request = requestTransfer } = {}) {
  await ctx.tool.transform((editor) => {
    editor.add({
      name: 'machinal_download',
      description: 'Download an approved completed machinal job, named project media, or public HTTPS internet file to the client computer. Native streaming with compact progress, no PowerShell/curl/scripts. Provide projectId + jobId/file, or url + directory + filename. Reuses saved authentication in memory; never pass keys or signed project URLs. Local delivery only when requested. Never overwrites; checks byte count and reports SHA-256. Internet downloads do not upload/import files or execute them.',
      input: { type: 'object', additionalProperties: false, required: ['userApproved'], properties: {
        projectId: { type: 'string' }, jobId: { type: 'string' }, file: { type: 'string' },
        storage: { type: 'string', enum: ['s3', 'volume'], description: 'From the approved media listing; s3 even when cached. Default s3.' },
        server: { type: 'string', description: 'Approved machinal MCP registration; omit for the first configured server.' },
        url: { type: 'string', description: 'Public HTTPS source only; for machinal output use projectId and jobId/file instead.' },
        directory: { type: 'string', description: 'Approved absolute client-local directory; project downloads can reuse the saved preference.' },
        filename: { type: 'string', description: 'Plain new filename, required for internet downloads.' },
        userApproved: { type: 'boolean', description: 'True only after explicit approval for this source and local delivery. Listing consent is insufficient.' },
      } },
      options: { codemode: false },
      async execute(input, context) {
        try { validateDownload(input); } catch (error) { return failure(error); }
        const resource = input.url ? new URL(input.url).origin : `${input.server ?? 'machinal'}/${input.projectId}/${input.jobId ?? input.file}`;
        // Permission rejections must propagate to the host, not become successful tool output.
        await permission(ctx, context, 'machinal_download', [resource]);
        const signal = AbortSignal.any([context.signal, lifetime, AbortSignal.timeout(10 * 60 * 1000)].filter(Boolean));
        let source;
        let directory;
        let path;
        try {
          source = input.url ? { directory: input.directory, filename: input.filename,
            delivery: async () => ({ url: input.url }) }
            : await projectSource(input, await getConnection(input.server), signal, request);
          directory = await downloadDirectory(source.directory);
          path = join(directory, downloadFilename(source.filename));
          await assertNewDownload(path);
        } catch (error) { return failure(error, signal); }
        await permission(ctx, context, 'edit', [path]);
        try {
          await context.progress({ status: 'Downloading', filename: source.filename });
          const delivery = await source.delivery();
          const result = await saveDownload({
            ...delivery, directory, filename: source.filename, signal, progress: context.progress,
            request: { trustedOrigin: delivery.trustedOrigin, request },
          });
          return { content: JSON.stringify({ status: 'completed', ...result }) };
        } catch (error) { return failure(error, signal); }
      },
    });
  });
}

function failure(error, signal) {
  let message = 'Download failed. Check the network, directory permissions and free disk space. No existing file was overwritten.';
  if (error instanceof TransferError) message = error.message;
  else if (signal?.aborted) message = 'Download cancelled or timed out. Partial files were removed; no final file was published.';
  else if (error.code === 'EEXIST') message = 'The destination already exists. Choose another filename; it was not overwritten.';
  return { content: JSON.stringify({ status: 'failed', error: message }) };
}
