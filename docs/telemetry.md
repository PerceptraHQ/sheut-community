# Anonymous diagnostics and usage

Sheut Community is local-first. Telemetry is disabled until a user explicitly
enables **Anonymous diagnostics and usage** in the first-run dialog or in **Settings →
Data & security**. Declining does not create an installation identifier and
does not send a telemetry request.

The production ingestion endpoint is
`https://telemetry-api-production-f7f4.up.railway.app/v1/events`. The deployable
gateway is kept in a separate private repository. This document and the
client-side contract stay public so Community users can review exactly what
Sheut can send.

## Event contract

The client submits only `schemas/telemetry-event-v1.schema.json`. Every event
contains exactly these fields:

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Contract revision; currently `1`. |
| `eventId` | Random identifier used to reject duplicate submissions. |
| `installationId` | Random identifier created only after opt-in. |
| `occurredAtUnixMs` | Event time in Unix milliseconds; the gateway rounds stored analytics time to the minute. |
| `appVersion` | Sheut application version. |
| `operatingSystem` | One of `linux`, `macos`, or `windows`. |
| `architecture` | Supported CPU architecture. |
| `eventName` | One fixed, allowlisted usage or error category. |

There is no free-form message, stack trace, breadcrumb, attachment, URL,
project identifier, count, or metadata map. Both the Tauri isolation layer and Rust
deserialize the event name as a closed enum. Rust constructs all other fields;
the React webview cannot supply them.

Usage names describe only a coarse completed action or opened workspace, such
as `graph_opened`, `evidence_import_completed`, or `publication_completed`.
They do not describe which project, graph, evidence item, report, section,
template, format, object, or record was involved. Error names are similarly
fixed and contain no message, stack trace, or runtime context.

## Data that is never collected

- project names, identifiers, database values, or encryption material;
- report titles, sections, fields, rows, investigation content, analyst notes,
  or rich-text content;
- graph nodes, edges, labels, properties, layouts, identifiers, or counts;
- STIX objects, drafts, relationships, imports, or exports;
- evidence metadata, analyst notes, evidence files, attachments, or images;
- searches, local paths, filenames, URLs, or publication destinations;
- exception messages, panic messages, stack traces, or console breadcrumbs;
- names, email addresses, account identifiers, or analyst identity; and
- credentials, secrets, passphrases, database keys, or recovery material.

The HTTPS service necessarily receives a source IP while handling a network
connection. The gateway may use it transiently for abuse prevention, but must
not persist it or write it to application logs.

## Consent and delivery

- `unknown`: no identifier and no delivery;
- `disabled`: a recorded opt-out, no identifier and no delivery; and
- `enabled`: one random installation identifier stored in application-local
  settings, never in a project database.

Turning telemetry off deletes the local installation identifier immediately.
There is no disk-backed telemetry queue, no delivery retry, and no telemetry
generated before consent. Opt-out stops future reports; already delivered
events expire under the gateway and ClickHouse retention policies.

Release builds receive the endpoint through the reviewed
`SHEUT_TELEMETRY_ENDPOINT` build variable. Rust accepts only HTTPS, the exact
`telemetry-api-production-f7f4.up.railway.app` host, and the exact `/v1/events`
path, with no URL credentials, custom port, query, fragment, or redirects.

## Gateway requirements

The separate gateway must:

1. accept only `POST /v1/events` with `application/json`;
2. reject bodies larger than 4 KiB, unknown fields, and invalid enum values;
3. rate-limit by transient keyed source-IP hash and installation identifier;
4. reject duplicate `eventId` values within a bounded replay window;
5. derive purpose-specific, rotating identifiers with a server-side HMAC,
   then immediately discard the raw installation identifier;
6. disable request-body, source-IP, and header logging;
7. batch usage and fixed error categories into ClickHouse using only the fixed
   event name, minute-rounded time, application version, operating-system
   family, CPU architecture, and a daily rotating pseudonym;
8. expire event-level analytics rows after 30 days, retain only anonymous
   daily aggregates for up to 13 months, and never persist request bodies,
   source IPs, event IDs, or raw installation identifiers; and
9. return a generic status without echoing submitted data.

The private gateway repository is an implementation detail, not a secrecy
control: the endpoint is public by necessity. Abuse resistance comes from
small bodies, strict decoding, bounded concurrency and queues, replay checks,
rate limits, upstream filtering, and generic responses.
