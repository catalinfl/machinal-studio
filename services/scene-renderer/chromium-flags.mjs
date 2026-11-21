export const sceneChromiumFlags = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--enable-blink-features=CanvasDrawElement',
  '--enable-experimental-web-platform-features',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
];

export function requiresWebGPU(source) {
  return /from\s*['"]@machinal\/hyperframes\/shaders['"]/.test(source);
}
