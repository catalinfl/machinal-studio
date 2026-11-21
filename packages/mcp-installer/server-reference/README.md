# Hosted compatibility references

These Markdown-only guides were copied from the current upstream source snapshot identified in the root `.machinal-local.json`. They contain no account configuration or credentials.

The installer still supports explicit **Server** connections, so its hosted skill bundle must retain hosted authentication/storage/billing guidance. `scripts/sync-reference.mjs` uses this separate source for that bundle in the local fork. The local Go guides are independently synchronized into `skills/machinal-local/references`, installed only by **Local** setup. Never merge the two deployment contracts or copy production environment files here.
