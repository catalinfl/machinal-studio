export class InstallerError extends Error {
  constructor(message, { code, status, retryable = false } = {}) {
    super(message);
    this.name = 'InstallerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
