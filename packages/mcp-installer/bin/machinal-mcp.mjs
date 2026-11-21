#!/usr/bin/env node

import { run } from '../src/cli.mjs';
import { InstallerError } from '../src/errors.mjs';
import { createLogger } from '../src/presentation.mjs';

try {
  process.exitCode = await run();
} catch (error) {
  if (error?.name === 'ExitPromptError') {
    console.error('Cancelled.');
    process.exitCode = 130;
  } else {
    createLogger({ write: console.error, stream: process.stderr })(error instanceof InstallerError
      ? error.message
      : 'Unable to complete setup. Check file permissions, Node.js, and client installation, then retry.', 'error');
    process.exitCode = 1;
  }
}
