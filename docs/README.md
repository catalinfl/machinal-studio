# Documentation

## Start with the local edition

- [Installation, Docker, user-owned key and data](../README.md)
- [Fork boundaries and compatibility code](../LOCAL_FORK.md)
- [Local MCP workflow](MCP.md)
- [Standalone verification and limits](LOCAL_VERIFICATION.md)
- [Server versus Local installer](../packages/mcp-installer/README.md)
- [Product contract](../PRODUCT.md)
- [Editor visual contracts](../DESIGN.md)
- [Compiler and recipe reference](../api/editengine/README.md)
- [Current scene service](../services/scene-renderer/README.md)

The local editor also serves `/docs` and `/toolkit`. Root/local guides take precedence over inherited hosted deployment details.

## Inherited technical references

These describe the upstream source architecture. Account, payment, PocketBase, S3, retention and hosted-credit sections are **not local installation requirements**. They are retained for engineering comparison, not instructions to connect this fork to maintainer infrastructure.

- [Architecture](ARCHITECTURE.md)
- [Saved project schema](PROJECTS.md)
- [Automation/compiler behavior](API_AUTOMATION.md)
- [Background job concepts](BACKGROUND_JOBS.md)
- [Render performance](RENDER_PERFORMANCE.md)
- [Upstream test prerequisites](TESTING.md)

Private deployment files, personal `.env`/agent configuration and historical generated reports were intentionally not copied.
