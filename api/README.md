# Bomkeeper waitlist API

Node.js 22 Azure Functions, deployed as the managed API of the existing Static
Web App. The website progressively enhances ordinary HTML forms with asynchronous
submission and inline status messages in English and German. Without JavaScript,
the forms still work and show an API response page; no external form provider is needed.

## Flow

1. `POST /api/waitlist` validates the form and its explicit consent. It stores a
   pending signup in private Table Storage and submits a confirmation email via
   Azure Communication Services. The API waits only for ACS to accept the queued
   send, not for email-completion polling. Delivery continues at ACS independently
   of the HTTP request; no unawaited work runs inside the function. Clients requesting
   `Accept: application/json` receive a JSON status message instead of an HTML page.
2. The branded HTML email includes a plain-text fallback and a signed confirmation
   link valid for 48 hours. Opening
   the link immediately confirms the signup, without a second button click.
   Email link scanners that open the link can also confirm a signup.
3. `GET /api/waitlist/confirm` records confirmation time. Existing POST links
   remain supported. Only records with
   `status=confirmed` are eligible for future updates.
4. The email and confirmation page include an unsubscribe link.
   Opening it displays a form; only `POST /api/waitlist/unsubscribe` permanently
   deletes the record. Email link scanners cannot unsubscribe with GET.

Token-authenticated POST actions accept `Origin: null`, which browsers can send
from the API pages with `Referrer-Policy: no-referrer`. They still validate the
signed token and its purpose. Registration continues to require a configured
website origin; missing and foreign origins are rejected for all POST actions.

Signups are normalized by email and protected by optimistic concurrency.
Confirmation emails have a per-address one-hour cooldown. Confirmed addresses
do not receive another confirmation email. The newest confirmation email
supersedes older links. A honeypot, origin checks, size limits and a persistent
global email budget help limit abuse. These are not a replacement for a CAPTCHA
or edge rate limiting if the form attracts targeted attacks.

The hourly budget defaults to 20 attempted emails across all API instances and
resets at each UTC hour. Failed attempts count towards this budget; rejected
email submissions can be retried after one minute. An HTTP 503 or 429 is shown
on submission failure rather than claiming that an email was queued. A successful
response means ACS accepted the operation, not that delivery completed. Monitor
post-acceptance failures and delivery status through ACS diagnostics; these cannot
be reported in the already-completed HTTP response and retain the one-hour cooldown.
Duplicate signups use the same generic response to avoid exposing membership.

## Settings

Terraform configures these server-side settings; never add their values to HTML
or commit a real `local.settings.json`.

| Setting | Meaning |
| --- | --- |
| `WAITLIST_STORAGE_CONNECTION_STRING` | Storage account connection string |
| `WAITLIST_TABLE` | Private signup table, `Waitlist` |
| `WAITLIST_LIMITS_TABLE` | Private budget table, `WaitlistLimits` |
| `WAITLIST_EMAIL_CONNECTION_STRING` | Communication Services connection string |
| `WAITLIST_EMAIL_ENABLED` | `true` only after email DNS verification and linking |
| `WAITLIST_SENDER` | Verified sender, `waitlist@bomkeeper.dev` |
| `WAITLIST_BASE_URL` | Canonical origin used in emails |
| `WAITLIST_ALLOWED_ORIGINS` | Comma-separated website origins permitted to POST |
| `WAITLIST_TOKEN_SECRET` | Random secret of at least 32 characters |
| `WAITLIST_HOURLY_EMAIL_LIMIT` | Integer 1-1000, default provisioned value 20 |

Retain the token secret in secured Terraform state and backups. Rotating it
invalidates existing confirmation and unsubscribe links; after a planned
rotation, issue fresh unsubscribe links for future emails.

## Tests and local development

```bash
cd api
npm ci
npm test
```

The tests do not send emails or contact Azure. To run locally, install Azure
Functions Core Tools v4 and Azurite, copy `local.settings.json.example` to
`local.settings.json`, supply a token secret and create the two tables in
Azurite. Use SWA CLI to serve `website/` with the API on port 7071:

```bash
# Terminal 1: start Azurite, then
cd api
npm start

# Terminal 2, project root
npx --yes @azure/static-web-apps-cli@2.0.10 start ./website --api-location http://localhost:7071
```

Email sending defaults to disabled locally and returns 503 intentionally.
For an end-to-end test, configure a real verified ACS sender and connection
string and set `WAITLIST_EMAIL_ENABLED=true`. Localhost must remain in
`WAITLIST_ALLOWED_ORIGINS`.

## Maintenance and future announcements

Table Storage does not automatically expire records. Run cleanup **daily** from
a trusted environment with the storage settings above:

```bash
cd api
node scripts/manage.js prune
```

This deletes only expired, unconfirmed signups, using ETags to avoid deleting a
concurrent resend or confirmation. Scheduling the command is an operational
requirement; managed SWA APIs support HTTP triggers, not timer triggers.

Export confirmed subscribers as newline-delimited JSON:

```bash
node scripts/manage.js export > /secure/location/waitlist.jsonl
```

Export also requires the token secret and base URL. It includes a newly signed
unsubscribe URL per subscriber, valid until deletion, replacement or token-secret
rotation. Include that link in **every** future announcement and re-export
immediately before sending. Exports contain
personal data and bearer unsubscribe links: restrict access, do not commit them
and delete them when no longer required. Do not reuse stale exports after
subscribers unsubscribe.

This implementation sends only double-opt-in emails; campaign sending is not
included. Before going live, update the existing privacy policy to describe
the waitlist, Azure processors, retention, consent and deletion. Establish a
retention period for confirmed subscribers, and delete the list when the
waitlist's purpose ends.
