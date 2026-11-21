const minReportIntervalMs = 5000;
const maxPendingCharacters = 512;

export function observeRendererProgress(child, report, now = performance.now.bind(performance)) {
  const stderr = child?.stderr;
  if (!stderr) return () => {};

  const started = now();
  let pending = '';
  let lastReported = -Infinity;
  let lastFrame = 0;

  function line(value) {
    const match = /^frames (\d+)\/(\d+)(?:\s|$)/.exec(value);
    if (!match) return;
    const writtenFrames = Number(match[1]);
    const totalFrames = Number(match[2]);
    if (!Number.isSafeInteger(writtenFrames) || !Number.isSafeInteger(totalFrames)
      || writtenFrames <= lastFrame || writtenFrames > totalFrames || totalFrames < 1) return;

    const current = now();
    if (lastFrame > 0 && writtenFrames !== totalFrames && current - lastReported < minReportIntervalMs) return;
    lastFrame = writtenFrames;
    lastReported = current;
    report({ writtenFrames, totalFrames, progress: writtenFrames / totalFrames, elapsedMs: Math.round(current - started) });
  }

  function data(chunk) {
    const lines = (pending + chunk.toString()).split('\n');
    pending = lines.pop().slice(-maxPendingCharacters);
    for (const value of lines) line(value);
  }

  stderr.on('data', data);
  return () => {
    stderr.off('data', data);
    if (pending) line(pending);
    pending = '';
  };
}
