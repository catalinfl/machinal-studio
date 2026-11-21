# machinal local

This is the standalone fork, not the hosted application. Read README.md and LOCAL_FORK.md first. Preserve the current editor/compiler/scene features while keeping these invariants:

- No machinal account, application key, Premium gate, payment or credit wallet in local runtime.
- No maintainer environment files, data volumes, object storage or provider credentials.
- AI uses only the installation owner's explicitly configured OpenRouter key. Do not access saved hosted credentials or make paid test requests.
- Docker publishes loopback ports only; local API Host/Origin checks must remain enabled. Do not expose a keyless service publicly.
- Use the local durable job repository. Never replay interrupted provider jobs automatically.
- Media and exports persist in the user's volume; no session eviction or three-export retention.
- Inherited hosted guides/skills apply to editorial/runtime schemas only, not local authentication, cloud storage or billing.
- Never modify D:\test-web or D:\directional-public as a side effect of work in this fork.
