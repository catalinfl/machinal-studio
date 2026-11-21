# machinal credit-aware editing

Use get_credits for live account values. The tool is account-scoped by the current API key; do not provide a user/owner ID, credentials or a PocketBase token. Reading credits does not submit billable generation/rendering or initiate a purchase. The existing ledger may apply the normal monthly renewal on access.

## MCP code authoring versus paid server rendering

The current client AI writes/repairs scene CODE without a server-model generation fee. `compile_scene` saves validated live source, not an encoded scene video. Source compilation, source lookup and catalog selection use zero credits, but **server scene frame rendering AND server video encoding are billed**, alongside image/TTS/caption provider usage. Both render stages use the configured `pricing.renderPerMinute` rate with the existing duration/rounding rules; no new commercial price is invented. Server rendering needs a positive balance/configured tariff and spending approval. The host AI's own subscription limits remain separate. `mcpPricing` exposes the distinction explicitly.

Pending `scene.generate`/`scene.edit` are rejected before any billed media work; use `compile_scene` and place the actual returned asset. No server-model fallback or paid repair is performed. See `get_editing_reference(topic=scene-authoring)`.

Speech generation and caption/transcription provider requests each have a **minimum charge of 1 credit when verified provider consumption is positive**, shared by MCP and REST API. Larger usage retains the existing calculation; this is not a fixed one-credit tariff. Explicitly zero-cost provider usage stays zero. Unknown cost stays pending, never guessed or described as free. Reusing resolved speech/captions or a cached transcript does not trigger a new provider charge. Read `mcpPricing.speechMinimumCredits` and `mcpPricing.transcriptionMinimumCredits` for the deployed minimums.

## Explain the wallet honestly

- data.balance.remaining is the current balance. Do not reserve it or deduct an estimate before work. Keep user-facing amounts concise and approximate rather than reciting microcredit precision.
- reserved is retained as zero for API compatibility. There is no "reserved for current work" balance.
- debt blocks additional spending. usagePending means some credit charges are still being finalized; it does not lock the balance or block unrelated work. Never describe unresolved usage as free.
- nextReset describes the monthly reset; purchased credits do not expire. Use returned values, not a hardcoded monthly grant or a cached screenshot.
- data.pricing.configured indicates whether paid API operations have configured rates. A nonzero balance does not make unconfigured pricing or missing providers usable.
- API keys on one account share one wallet. Local API connection mode does not imply free usage, keyless access, or a separate balance.
- Explain AI usage in machinal credits, not underlying supplier prices or internal cost-conversion rules. A credit's displayed USD value is not a promise of equivalent external AI spending. Give the user's actual credit consumption, not an invented exchange rate.

## Before paid work

1. Read the source metadata, current recipe schema and capabilities. Validate/compile without paid work, and list pending image, voice and caption/transcription actions. Scene source is written by the current client and compiled separately for free.
2. Check get_credits internally. If the balance cannot be verified, explain that briefly; do not invent a value or submit paid work while verification is unresolved.
3. Estimates are approximate, not reservations or an exact AI quote. Below 30 credits, warn briefly before paid work. Scene CODE from the current client has no server-model fee; server scene frames and final video encoding are charged at the actual configured render rate. Report `sceneRenderCredits`, `renderCredits`, `aiCredits` and pending usage separately. With sufficient credits, focus on the edit instead of repeated budget questions.
4. Debt, no available credit or unconfigured pricing can block new work. Pending provider metadata alone cannot. Do not buy credits automatically.
5. Present the edit plan and obtain explicit authorization for paid work. When the paid scope is already known, put this as a separate explicit question with a refusal option in the host's native brief form (OpenCode: `question`), after checking live credits. An approval covering generation and final rendering applies to those stages of the same workflow; after the user's answers proceed with authorized work without a separate plan confirmation or repeated approval of covered stages. Ask only for new paid scope or missing permission; a cancelled form grants nothing. Setup, skill installation and style selection alone are not spending authorization.

## Submission and recovery

- Use one stable idempotencyKey per exact paid operation. After an uncertain response, reuse that key with the same composition. Inspect recent jobs/media before intentionally starting new paid work.
- Jobs return 202 and run asynchronously. Starting a job opens an operation record, not a wallet reservation. Actual verified consumption is debited when the operation settles; an accepted job can still fail before execution because the account changed.
- Prefer wait_for_job(timeoutSeconds:120) for a bounded completion wait that ignores heartbeat revisions. get_job is an immediate progress snapshot. Status responses are compact; retrieve get_job_result once for resolved YAML. Inspect status and statusCode: a successful lookup is not successful rendering. Do not write local sleep loops. Closing the client does not cancel a job.

- Optional suggest_tools returns the free catalog for selection by the current client AI, without a provider call. It grants no media/spending permissions and executes no actions. Use the ordinary catalog directly when selection is obvious. No credits are purchased automatically.
- After completion, refresh get_credits and report the job's cost fields. cost.status=pending means knownCredits is a subtotal, not the final cost. Never calculate the job's exact charge solely from before/after wallet differences: other keys, renewal or purchases can change the same wallet.
- `cost.renderUsage` explains each newly recorded video/scene render charge with its actual `durationSeconds`, `creditsPerMinute`, `billedCredits` and `rounding`. The current rule is `floor-whole-credits-per-render`: round down separately for the final export and each distinct rendered scene, not after summing all scene durations. This explains why short scenes may each bill zero and why a roughly one-minute export at 10 credits/minute may bill 9. Legacy charges without this metadata remain unknown; do not reconstruct an exact breakdown from today's tariff. Cached scene processing does not itself prove that billing was waived.
- Failed/cancelled work may still include actual AI charges. Reuse successful generated assets where appropriate; do not blindly rerun the entire recipe or assume a full refund.
