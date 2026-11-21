import { styleText } from 'node:util';

export const API_KEYS_URL = 'https://machinal.app/api-keys';
export const MEMBERSHIP_URL = 'https://machinal.app/membership';
export const DOCKER_URL = 'https://docs.docker.com/get-started/get-docker/';

export function terminalStyle({ stream = process.stdout, env = process.env } = {}) {
  const color = Boolean(stream.isTTY && !Object.hasOwn(env, 'NO_COLOR') && env.TERM !== 'dumb');
  return (role, text) => color ? styleText(role, text, { validateStream: false }) : text;
}

export function createLogger({ write = console.log, stream = process.stdout, env = process.env } = {}) {
  const style = terminalStyle({ stream, env });
  return (message, kind) => {
    if (!message) return;
    if (kind === 'heading') return write(`\n${style('bold', message)}`);
    if (kind === 'error') return write(`${style('red', 'Error:')} ${message}`);
    const label = message.match(/^(Warning:|Low balance:|Usage awaiting payment:|[^:]*unavailable:)/)?.[0];
    if (label) return write(style('yellow', label) + message.slice(label.length));
    write(message);
  };
}

export function backupSummary(configuration, skills, root) {
  const count = (configuration.backup ? 1 : 0) + (skills?.backups.length ?? 0);
  if (!count) return null;
  const details = [configuration.backup ? `Configuration: ${configuration.backup}` : null,
    skills?.backups.length ? `Skills: ${skills.backups.length} files under ${root}` : null].filter(Boolean);
  return `Backups: ${count} original files preserved. ${details.join('; ')}. Skill backups are beside each original, named <filename>.machinal-backup-<timestamp>-<id>; restore by copying the backup over its original. Backups may contain existing secrets; keep them private.`;
}
