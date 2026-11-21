import { chromium } from '@playwright/test';
export { chromium };

// Headless Shell on Windows does not load Dawn's DXIL libraries correctly.
// Use the complete Chromium shipped by the SAME Playwright installation.
export const nativeBrowserOptions = {
  executablePath: chromium.executablePath(),
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--enable-blink-features=CanvasDrawElement',
    '--enable-experimental-web-platform-features',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : []),
  ],
};
