import { terminalStyle } from './presentation.mjs';

export function createPromptUI(prompts, options = {}) {
  const style = terminalStyle(options);
  const stream = options.stream ?? process.stdout;
  const theme = {
    prefix: { idle: '?', done: '-' },
    spinner: { interval: 120, frames: ['-', '\\', '|', '/'] },
    icon: { cursor: '>' },
    style: {
      message: (text, status) => status === 'done' ? text : style('bold', text),
      answer: (text) => text,
      highlight: (text) => style('cyan', text),
      description: (text) => text,
      help: (text) => text,
      disabled: (text) => text,
      defaultAnswer: (text) => `(${text})`,
      confirmDefault: (text) => text.toUpperCase(),
      key: (text) => `<${text}>`,
      error: (text) => `${style('red', 'Error:')} ${text}`,
      keysHelpTip: () => stream.columns < 60
        ? '  Up/down · Enter · Ctrl+C cancels'
        : '  Up/down to move · Enter to select · Ctrl+C to cancel',
    },
  };
  return Object.fromEntries(Object.entries(prompts).map(([name, prompt]) => [name, (config, context) => prompt({
    ...config,
    ...(name === 'select' ? { pageSize: 5, loop: false } : {}),
    ...(name === 'password' ? { toggleMask: false } : {}),
    theme: name === 'password' ? { ...theme, style: { ...theme.style, answer: () => '[hidden]' } } : theme,
  }, context)]));
}
