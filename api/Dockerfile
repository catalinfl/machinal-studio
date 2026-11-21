FROM golang:1.27.3-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o edit ./cmd/edit

FROM alpine:latest AS runtime

RUN apk add --no-cache ffmpeg ca-certificates wget su-exec && adduser -D -H appuser

WORKDIR /app

COPY --from=builder /app/server .
COPY --from=builder /app/edit /usr/local/bin/edit
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown appuser:appuser /app /app/server /data

ENTRYPOINT ["/entrypoint.sh"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["./server"]

FROM debian:bookworm-slim AS gpu
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates wget gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --no-create-home --uid 1000 appuser
WORKDIR /app
COPY --from=builder /app/server .
COPY --from=builder /app/edit /usr/local/bin/edit
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh && mkdir -p /data && chown appuser:appuser /app /app/server /data
ENTRYPOINT ["/entrypoint.sh"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ || exit 1
CMD ["./server"]

FROM runtime AS default
