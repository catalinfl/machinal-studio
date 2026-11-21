FROM node:24-bookworm-slim AS dependencies
WORKDIR /opt/scene-service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS service
ARG CHROME_VERSION=151.0.7922.34
ARG TARGETARCH
RUN test "$TARGETARCH" = "amd64" \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip ffmpeg \
       libnss3 libatk-bridge2.0-0 libx11-6 libxcomposite1 libxdamage1 libxrandr2 \
       libgbm1 libasound2 libatk1.0-0 libcups2 libdrm2 libxkbcommon0 fonts-dejavu-core \
    && curl -fL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" -o /tmp/chrome.zip \
    && unzip /tmp/chrome.zip -d /opt/chrome \
    && rm /tmp/chrome.zip \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 scene \
    && mkdir -p /var/cache/scene \
    && chown scene:scene /var/cache/scene \
    && dpkg-query -W > /opt/scene-render-environment
WORKDIR /opt/scene-service
COPY --from=dependencies /opt/scene-service/node_modules ./node_modules
# npm archives can preserve the native binary as 0644; the service runs non-root on a read-only image.
RUN chmod 0755 node_modules/@machinal/scenes/native/linux-x64/scene-render
COPY . .
RUN chmod 0755 scripts/scene-chromium.sh
COPY --from=client-source src/lib/text-render.ts src/lib/text-geometry.ts src/lib/caption-layout.ts ./text-source/
ENV SCENE_BROWSER=/opt/scene-service/scripts/scene-chromium.sh \
    SCENE_FFMPEG=/usr/bin/ffmpeg \
    SCENE_RENDER_MANIFEST=/opt/scene-render-manifest.json \
    SCENE_SERVICE_HOST=0.0.0.0 SCENE_NO_SANDBOX=true PORT=8091 TEXT_SOURCE_ROOT=/opt/scene-service/text-source
USER scene
RUN node --input-type=module -e "import { ensureRendererReady } from './renderer.mjs'; await ensureRendererReady();"
USER root
RUN node scripts/build-renderer-manifest.mjs "$SCENE_RENDER_MANIFEST"
USER scene
EXPOSE 8091
CMD ["node", "server.mjs"]
