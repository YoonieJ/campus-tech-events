# Campus Tech Events

A single-page site where students can browse and submit company events, career
fairs, and tech talks for their campus. Currently scoped to UT Austin, with
room to add more schools.

**Status:** early preview. The page ships with hardcoded sample events and the
submit form disabled until a backend is deployed (see below).

## Features

- Browse events with search, and filters by school, company, and event type
- "Upcoming only" toggle
- Add any event to your calendar (downloads an `.ics` file)
- "Flower" button to show interest in an event, with a running count
- Submission form for students to add new events (held for review before
  they appear publicly)

## Project structure

- [index.html](index.html) — the entire frontend: markup, styles, and vanilla
  JS. No build step, no dependencies. Open it directly in a browser or serve
  it as a static file.
- [get-events.mjs](get-events.mjs) — Lambda handler for `GET /events`, returns
  approved events for a school from DynamoDB.
- [post-events.mjs](post-events.mjs) — Lambda handler for `POST /events`,
  saves a submitted event with `status: "pending"` for manual review.
- [post-flower.mjs](post-flower.mjs) — Lambda handler for
  `POST /events/{id}/flower`, increments an event's interest count with a
  per-network dedup window to slow down repeat-clicking.
- [backend-deploy.md](backend-deploy.md) — step-by-step guide for standing up
  the DynamoDB + Lambda + API Gateway backend behind the page.
- `roses.png` — flower icon shown on the interest button (the page falls back
  to an inline SVG if this file isn't present next to `index.html`).

## Running locally

The frontend has no dependencies and no build step:

```
open index.html
```

or serve the directory with any static file server. With `API_BASE` left
empty (the default, set near the top of the `<script>` in `index.html`), the
page shows the hardcoded `SAMPLE_EVENTS` and keeps the submit form disabled.

## Backend

The real backend is AWS-based: DynamoDB for storage, Lambda for the three
handlers above, and an HTTP API (API Gateway) in front of them. Follow
[backend-deploy.md](backend-deploy.md) for the full setup, then point the
page at your API by setting `API_BASE` in `index.html` to your API's invoke
URL.

Event submissions are not auto-published — every submission lands as
`pending` and has to be manually flipped to `approved` in the DynamoDB
console.

## Notes and limitations

- Only UT Austin is configured right now (see the `SCHOOLS` array in
  `index.html`); adding a school means adding it there and in the Lambda
  handlers' allowed values.
- The flower counter is a per-network interest signal, not a per-person vote
  — there's no login, so dedup is done by hashing the requester's IP, which
  means a shared network (dorm wifi, campus NAT) can block a roommate's
  flower for the same event.
- Client-side validation exists for UX, but all fields are re-validated in
  `post-events.mjs` since a client-side check can always be bypassed.
