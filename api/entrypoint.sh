#!/bin/sh
set -e
# Named volumes (api-data:/data) arrive owned by root:root, which hides the
# chown done at build time. The server runs as appuser, so fix ownership at
# container start (as root) before dropping privileges. Without this,
# EnsureUserDir fails with "permission denied" -> POST /sessions 500 and
# GET /list 401 ("login required" via ResolveRoot fallback).
if [ -d /data ]; then
  chown -R appuser:appuser /data 2>/dev/null || true
fi
cd /app
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec appuser:appuser "$@"
fi
exec gosu appuser:appuser "$@"
