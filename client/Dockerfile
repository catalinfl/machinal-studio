FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_BASE
RUN test -n "$VITE_API_BASE" && pnpm build

FROM nginx:1.28-alpine AS runtime
ENV PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
