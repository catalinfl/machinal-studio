---
name: machinal-credits
description: Handle machinal post-usage credits, approximate estimates, low balances, pending/final costs and idempotent recovery. No wallet reservations or exact advance AI quotes. Never purchase credits automatically.
---

# Credit-aware editing

Use the deployed `mcpPricing.speechMinimumCredits` / `transcriptionMinimumCredits`: each new voice or caption/transcription provider request has a minimum of 1 credit when verified consumption is positive. Higher usage keeps its calculated charge. Explicit zero-cost usage stays zero; unknown usage stays pending. Reusing resolved assets/captions or cached transcripts makes no new provider charge. This is not a fixed one-credit quote for every job.

The CURRENT client AI writes/repairs scene CODE without a server-model fee. Source compilation is not a rendered scene video. Server scene frame rendering AND final video encoding consume credits at the configured render tariff, alongside image/TTS/caption usage. Check pricing, balance and spending/source consent before rendering. Report sceneRenderCredits, renderCredits and aiCredits separately. No server scene-model fallback is permitted. Source lookup/compilation and catalog selection remain free; the client AI's own subscription/usage is separate. Read get_editing_reference(topic=scene-authoring).

1. Read `machinal://skills/credits` and check `get_credits` with no owner or credential arguments. Credits are not reserved for current work. Keep estimates approximate and user-facing amounts concise; report actual consumption at the end. Never fabricate a balance or submit paid work if verification fails.
2. Validate/compile the recipe and list pending generation actions before paid execution. Unconfigured pricing, debt or no available credit can block work. Pending provider metadata is informational and must not block unrelated operations or zero the wallet.
3. Below 30 credits, warn briefly before paid work. Server scene/video rendering is billed using the configured render tariff; only client-authored scene CODE avoids the server-model fee. Never invent a rate, exact AI total or hard upstream spending cap. With sufficient credit, focus on the edit rather than repeated budget questions.
4. Obtain explicit authorization for paid work once for the explained workflow, including its generation/render stages. When paid scope is known and live credits checked, use the host's native question tool (OpenCode: `question`) to include a distinct spending question with a refusal option in the same brief form, not a numbered chat questionnaire. After answers, proceed immediately with authorized work without a separate plan confirmation or repeated approval of covered stages. A cancelled form grants nothing. Installation, local connection mode, skill activation and style selection alone are not authorization. Do not purchase credits automatically.
5. Use a stable `idempotencyKey` for each exact paid operation. On an uncertain submission, retry only with that key and the same composition. Inspect jobs and media before intentionally creating new paid work.
6. Prefer `wait_for_job(timeoutSeconds:120)` for a bounded terminal-state wait ignoring heartbeat revisions; `get_job` is for an immediate snapshot. Do not write local sleep scripts. Retrieve `get_job_result` once for reusable results/YAML or compiler diagnostics. Inspect the job itself, not just lookup status; success is only `completed`. Closing the client does not cancel work. Optional `suggest_tools` is a free catalog for selection by the current client AI, not a server AI call. Suggestions execute nothing and grant no permissions.
7. After completion, refresh `get_credits` and report the job's actual cost fields. `cost.status=pending` makes `knownCredits` a subtotal, not a final charge. Do not infer an exact job charge from a wallet delta shared with other keys or monthly renewal.

Keep the key in the environment, never chat or YAML. Failed work can still include real AI charges; reuse successful generated assets instead of blindly rerunning a recipe.

Explain consumption in machinal credits. Do not quote underlying supplier prices, name internal AI infrastructure or reveal cost-conversion rules. Report actual credit usage and distinguish pending charges from final totals; do not invent a USD-to-AI exchange rate.
