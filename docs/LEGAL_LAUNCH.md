# Legal pages and browser-storage launch checklist

The English About, Privacy, Terms and Cookies pages describe this repository’s actual editing, project, AI, payment and storage workflows. They are **not legal certification**. The privacy/terms/storage pages remain visibly marked **Draft for review**, with `noindex`, while `legalIsDraft` is true in `client/src/lib/legal.ts`.

## Operator settings

Set the following **public, build-time** frontend values. They are not secrets. Never put service credentials in a `VITE_` setting.

```dotenv
VITE_LEGAL_OPERATOR_NAME=
VITE_LEGAL_OPERATOR_ADDRESS=
VITE_LEGAL_OPERATOR_COUNTRY=
VITE_LEGAL_CONTACT_EMAIL=
VITE_LEGAL_PRIVACY_EMAIL=
```

The privacy email falls back to the contact email. Rebuild the frontend after changing settings. Empty fields display “Not yet supplied”; no fictitious business or mailbox is published. Review the policy revision date in `legal.ts` when the text is actually approved.

## Required before a public launch

- Confirm legal name, legal form/registration/VAT disclosures where applicable, address, country and a working monitored contact/privacy mailbox.
- Have counsel review the text against the operator’s jurisdiction and intended customers; complete the governing-law/disputes text in `Terms.svelte` without removing mandatory consumer protections. The present terms restrict account creation/purchases to adults; enforce that policy operationally or revise the age rules and implement any necessary age/parental-authorisation controls.
- Replace draft provider/transfer paragraphs in `Privacy.svelte` with the real production register: hosting, account infrastructure, object storage, AI intermediaries/model providers, PayPal and OAuth providers. Identify roles, processing countries, privacy links, DPAs, provider retention/training terms and actual international-transfer safeguards. Do not infer these from the PocketBase software name or a model ID.
- Set and publish concrete retention/deletion schedules for accounts, projects, originals, outputs, support, logs, backups and accounting records. The 30-day job retention in source is not an all-media deletion policy. Verify the retention worker is deployed. Browser originals and sole volume originals may persist indefinitely; cloud cache cleanup does not erase cloud objects.
- Establish an operator-handled access/export/deletion/objection process, identity verification, response deadlines, deletion from relevant storage/providers and any legally necessary records. This work adds no backend erasure endpoint or one-click account deletion.
- Verify HTTPS, access policies, log/bearer-link redaction, backups, breach response and data-processing agreements for business-customer uploads. Avoid collecting sensitive or child data without appropriate controls.
- Confirm prepaid pass and credit rules against the deployed merchant configuration. Publish required tax/merchant disclosures. If relying on an exception to a consumer withdrawal right, add the legally required **separate** checkout request/acknowledgment and durable records before immediate performance. General terms and the storage notice do not waive that right.
- Review refunds operationally and ensure requests are actually handled; the existing refund-request endpoint does not pay out or notify the merchant automatically.
- Review terms acceptance and version evidence for password signup, OAuth account creation and checkout. The frontend displays a pre-signup legal notice; it does **not** introduce server-verified, versioned acceptance records or claim to enforce acceptance through the API.
- Audit the actual production site, CDN/reverse proxy and injected tags. The user confirmed no analytics/advertising; none was added. Any future non-essential script must be gated **before** it loads, with equal accept/reject access, granular choices, withdrawal, versioning and suitable evidence. This essential-only acknowledgment is deliberately not a generic consent-management platform.
- Update draft-only prose throughout the legal routes, then set `LEGAL_REVIEW_COMPLETE = true` **only after** this checklist is complete and operator fields are present. This removes the draft callout and `noindex`; it is not a substitute for the substantive edits.

## Browser storage implementation

`client/src/pages/Cookies.svelte` inventories keys verified against the source. Necessary service storage and explicitly requested editor functionality are distinguished from tracking. No optional tracking category or consent flag is invented.

The non-modal notice is mounted once in `App.svelte`, including the editor, and can be reopened from shared public footers, legacy-page legal links and Preferences. `direction-storage-notice` stores only `{version, acknowledgedAt}`. The app honours it for 180 days, rejecting stale, malformed and future timestamps; changing `STORAGE_NOTICE_VERSION` shows a new notice. Expiry invalidates the acknowledgment logically rather than guaranteeing browser deletion at a wall-clock time. Cross-tab dismissal sync is supported. Blocked storage closes the notice for the current visit without pretending it was saved. No originals, drafts, session tokens or jobs are cleared by dismissal.

The current notice requests no consent because there are no optional trackers. It never loads a provider, calls a paid tool, creates an analytics identifier or treats browsing as consent. GitHub/PayPal are user-initiated external flows; production infrastructure cookies still need a deployment audit.

## Reference guidance

- [EDPB: Respect individuals’ rights](https://www.edpb.europa.eu/sme-data-protection-guide/respect-individuals-rights_en) — layered transparency, rights and request handling.
- [CNIL: cookies and other tracking devices](https://www.cnil.fr/en/cookies-and-other-tracking-devices-cnil-publishes-new-guidelines) — no implied consent from browsing, prior consent where required and withdrawal. This is background guidance, not a jurisdiction-specific legal opinion.

No production provider, customer data, credentials or merchant account was inspected, and no paid processing was used for these changes.
