import { parseArgs } from 'node:util';
import { confirm, input, password, select } from '@inquirer/prompts';
import { InstallerError } from './errors.mjs';
import { createCredentialStore } from './credential-store.mjs';
import { manageKey, offerKeyStorage, readKey } from './keys.mjs';
import { launchClient } from './launch.mjs';
import { chooseClient, EDITING_STYLES } from './setup-options.mjs';
import { setup } from './setup.mjs';
import { VERSION } from './version.mjs';
import { createLogger } from './presentation.mjs';
import { createPromptUI } from './prompts.mjs';

const HELP = `machinal MCP setup (Node.js 22.13+ or 24+)

  npx @machinal/mcp setup
  npx @machinal/mcp setup --client opencode --url https://YOUR-API/mcp
  npx @machinal/mcp launch opencode
  npx @machinal/mcp launch codex -- --help
  npx @machinal/mcp key set       Save or replace the key (Windows)
  npx @machinal/mcp key set --url https://YOUR-API/mcp
  npx @machinal/mcp key delete    Remove the saved key (Windows)

Options for setup:
  --client opencode|claude|codex
  --scope project|global           Default: project
  --mode server|local              Server: existing API; Local: user's Docker
  --mode hosted                    Compatibility alias for server
  --url URL                        Local default: http://127.0.0.1:8080/mcp
  --docker-dir PATH                Local: machinal source checkout
  --start-docker                   Local: explicitly allow build/start if needed
  --name NAME                      Default: machinal (Server), machinal-local (Local)
  --replace                        Replace this named server only
  --style STYLE                    Named editorial profile (see below)
  --no-skills                      Do not install the bundled agent skills
  --replace-skills                 Back up and replace changed bundled files
  --yes                            No confirmations; requires client and URL/mode
  --no-launch                      Configure only; Local never needs an application key
  --verbose                        Show full setup, credit and authentication details
  --help, -h                       Show help
  --version, -v                    Show version

Options for setup/launch:
  --session-key                    Ignore saved keys; do not offer to save

Options for key delete:
  --yes                            Explicitly confirm removal without a prompt

Options for key set:
  --url URL                        Verify MCP access before replacing the saved key

The API key is read from MACHINAL_API_KEY, Windows Credential Manager, or a
hidden prompt, in that order, never from command arguments. On Windows you
can opt in to saving it in Credential Manager; no plaintext file is used.
OpenCode on Windows gets an automatic MCP authentication integration: one saved
machinal key, no separate launcher, in-memory headers and secure replacement.
When a key fails, ask the agent to reconnect or replace it; never paste it in chat.
Interactive setup/launch lets you keep, replace, or create a key even when a
key is already available. New keys are created on the website, not by the CLI.
key set always asks for a new key through hidden entry. key delete removes
only the local copy; it does not revoke the key or change running clients.
Setup verifies MCP and reads live credits, then installs optional
editing/YAML/credit skills. It does not render,
generate assets, or consume API credits. Server mode never starts Docker.
Without a key in the client environment or OpenCode automatic saved-key access,
setup requires immediate keyed launch. API verification is not a client connection check.
Local reuses a running API or offers Docker build/start from a configured
checkout. --yes alone never authorizes Docker changes. Server requires a
machinal application key and its account/billing rules. Local requires the
machinal-local Docker edition, uses the user's volume and hardware, and NEVER
asks for a machinal key or accesses hosted credentials. Configure your own
OpenRouter key in the local editor only when AI is needed. No S3 or machinal
credits are used locally. Server keys: https://machinal.app/api-keys.

Styles: ${EDITING_STYLES.join(', ')}.
`;

function parseOptions(argv) {
  const separator = argv.indexOf('--');
  const forwarded = separator < 0 ? [] : argv.slice(separator + 1);
  let parsed;
  try {
    parsed = parseArgs({
      args: separator < 0 ? argv : argv.slice(0, separator),
      allowPositionals: true,
      options: {
        client: { type: 'string' }, scope: { type: 'string' }, mode: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' },
        replace: { type: 'boolean' }, yes: { type: 'boolean' }, 'no-launch': { type: 'boolean' }, verbose: { type: 'boolean' },
        style: { type: 'string' }, 'no-skills': { type: 'boolean' }, 'replace-skills': { type: 'boolean' },
        'session-key': { type: 'boolean' },
        'docker-dir': { type: 'string' }, 'start-docker': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    });
  } catch {
    throw new InstallerError('Invalid options. Run --help. API keys must use MACHINAL_API_KEY or the hidden prompt, never command arguments.');
  }
  return { ...parsed, forwarded };
}

export async function run(argv = process.argv.slice(2), runtime = {}) {
  const { values, positionals, forwarded } = parseOptions(argv);
  if (values.help) { console.log(HELP); return 0; }
  if (values.version) { console.log(VERSION); return 0; }
  const command = positionals[0] ?? 'setup';
  const context = {
    env: process.env, cwd: process.cwd(), launch: launchClient,
    credentialStore: createCredentialStore(),
    ...runtime,
    interactive: !values.yes && (runtime.interactive ?? (process.stdin.isTTY && process.stdout.isTTY)),
  };
  context.ui ??= createPromptUI({ confirm, input, password, select }, { env: context.env });
  context.verbose = values.verbose || !context.interactive;
  context.log ??= createLogger({ env: context.env });
  if (command === 'key' && positionals.length === 2 && ['set', 'delete'].includes(positionals[1]) && !forwarded.length) {
    const allowed = positionals[1] === 'set' ? ['url'] : ['yes'];
    if (Object.keys(values).some((option) => !allowed.includes(option))) {
      throw new InstallerError('key set accepts only --url; key delete accepts only --yes. Run --help.');
    }
    return manageKey(positionals[1], values, context);
  }
  if (command === 'setup' && positionals.length <= 1 && !forwarded.length) {
    return setup(values, context);
  }
  if (command === 'launch' && positionals.length <= 2) {
    if (['scope', 'url', 'name', 'replace', 'no-launch', 'style', 'no-skills', 'replace-skills', 'start-docker', 'docker-dir', 'verbose'].some((option) => values[option] !== undefined)) {
      throw new InstallerError('Setup-only options cannot be used with launch. Run --help.');
    }
    if (values.client && positionals[1]) throw new InstallerError('Specify the launch client only once.');
    const client = await chooseClient(positionals[1] || values.client, context);
    if (values.mode === 'local') return context.launch(client, null, { args: forwarded, cwd: context.cwd, env: context.env, local: true });
    if (values.mode && !['server', 'hosted'].includes(values.mode)) throw new InstallerError('Choose --mode local or --mode server.');
    const keyOptions = { sessionOnly: values['session-key'] };
    const credentials = await readKey(context, keyOptions);
    await offerKeyStorage(credentials, context, keyOptions);
    const { key } = credentials;
    return context.launch(client, key, { args: forwarded, cwd: context.cwd, env: context.env });
  }
  throw new InstallerError('Use setup, launch, key set, or key delete. Run --help for examples.');
}
