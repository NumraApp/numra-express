# @numra/express

**Numra phone checks, outcome reporting and verified webhooks as an Express router.**

[![npm version](https://img.shields.io/npm/v/@numra/express)](https://www.npmjs.com/package/@numra/express) [![npm downloads](https://img.shields.io/npm/dm/@numra/express)](https://www.npmjs.com/package/@numra/express) [![licence: MIT](https://img.shields.io/npm/l/@numra/express)](LICENSE)

The backend endpoint that `@numra/react` calls. Holds your Numra API key so
the browser never does.

```bash
npm install @numra/express
```

## Mount it

```js
import express from 'express';
import { numraRouter } from '@numra/express';

const app = express();

app.use('/api/numra', numraRouter({
  apiKey: process.env.NUMRA_API_KEY,
  authorize: (req) => Boolean(req.session?.user),   // required
  webhookSecret: process.env.NUMRA_WEBHOOK_SECRET,  // optional
  onEvent: (event) => queue.add(event),
}));
```

Then on the page:

```jsx
import { useNumraCheck, RiskBadge } from '@numra/react';

const { data, isLoading } = useNumraCheck(phone);
<RiskBadge check={data} loading={isLoading} />
```

The two halves are built to meet — no glue between them.

## `authorize` is required, and defaults to deny

This route spends your Numra quota, and every lookup is billable. Without an
`authorize` function it is an open relay pointed at your own bill, so the
default **denies every request** and logs what to write.

Return `true` to allow. If your check throws, the request is denied — failing
closed, so a database blip cannot become an open door.

Keep the key in `.env` and out of version control. A key committed once is in
the history of every clone of that repository, and rotating it is the only fix.

## Rate-limit it too

`authorize` decides who may spend your quota, not how much. On a public
checkout those are different questions — the guard is a session that owns a
cart, and any visitor gets one by loading the page — so one session in a loop
is a bill. Put a limit in front of the router:

```js
import rateLimit from 'express-rate-limit';

app.use('/api/numra', rateLimit({ windowMs: 60_000, limit: 60 }), numraRouter({ ... }));
```

Sixty a minute is far above a real checkout and still bounds what a script can
spend. Exclude `/webhook` if you mount it — Numra retries a non-2xx, so a 429
there comes straight back as a redelivery.

## Webhooks and the raw body

Signature verification needs the exact bytes received. Once a body parser has
consumed the stream those bytes are gone, so pick one of these:

```js
// 1. Mount the router before any parser
app.use('/api/numra', numraRouter({ ... }));
app.use(express.json());

// 2. Or keep your app-wide parser and hand us the buffer
import { captureRawBody } from '@numra/express';
app.use(express.json({ verify: captureRawBody }));
app.use('/api/numra', numraRouter({ ... }));
```

Do neither and the webhook route returns **500 `NUMRA_RAW_BODY_UNAVAILABLE`**
with an explanation — deliberately not a 400, because "invalid signature"
reads as "Numra sent a bad webhook" and ends with someone disabling
verification.

The route acknowledges before running your `onEvent`, so a slow handler cannot
turn into duplicate deliveries.

**De-duplicate on `event.id` inside `onEvent`.** A retry reuses the id, and a
replay captured inside the 300-second signature window verifies perfectly — so
the router will call you twice for one event, and a handler that cancels an
order or sends an SMS will do it twice.

The webhook route is deliberately outside `authorize`. Its signature is its
authentication, it spends no quota, and Numra has no session to satisfy a
session check with.

## What reaches the browser

A subset: verdict, risk level and score, trust, confidence, `isRated`,
blacklist flag, customer style. Not `raw`, not engine internals, nothing that
names another merchant.

Upstream failures are translated rather than relayed. A rejected credential
becomes `502 UPSTREAM_UNAVAILABLE`, never a 401 — the merchant's credential
problem is not the visitor's business, and a 401 in the browser reads as
"you are logged out".

## Endpoints

| Method | Path | Body |
|---|---|---|
| POST | `/check` | `{ phone }` |
| POST | `/outcome` | `{ phone, orderId, outcomeType, … }` |
| POST | `/webhook` | raw, signed by Numra |

## Release notes

Every release is tagged and written up on the
[Releases page](https://github.com/NumraApp/numra-express/releases). The same
history in one file is in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and patches are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers
running the tests, the regression test a change is expected to bring with it,
and which repository a given fix actually belongs in.

## Security

Vulnerabilities go privately to the address in [SECURITY.md](SECURITY.md).
**Do not open a public issue for a security problem** — this router holds a
credential that reads a shared fraud ledger, and a public report is a working
exploit for every merchant using it until a fix ships.

## The rest of the family

Twelve packages, one contract. The server side holds the API key; the browser
side calls the endpoint the server side mounts.

Server:

| Package | Repository |
|---|---|
| `@numra/core` | [numra-js-core](https://github.com/NumraApp/numra-js-core) |
| `@numra/express` | [numra-express](https://github.com/NumraApp/numra-express) — this repo |
| `@numra/fastify` | [numra-fastify](https://github.com/NumraApp/numra-fastify) |
| `@numra/next` | [numra-next](https://github.com/NumraApp/numra-next) |
| `@numra/nuxt` | [numra-nuxt](https://github.com/NumraApp/numra-nuxt) |
| `numra/numra-php` | [numra-php](https://github.com/NumraApp/numra-php) |
| `numra/laravel` | [numra-laravel](https://github.com/NumraApp/numra-laravel) |

Browser:

| Package | Repository |
|---|---|
| `@numra/browser` | [numra-browser](https://github.com/NumraApp/numra-browser) |
| `@numra/react` | [numra-react](https://github.com/NumraApp/numra-react) |
| `@numra/vue` | [numra-vue](https://github.com/NumraApp/numra-vue) |
| `@numra/svelte` | [numra-svelte](https://github.com/NumraApp/numra-svelte) |
| `@numra/angular` | [numra-angular](https://github.com/NumraApp/numra-angular) |

Documentation for all of them is at [numra.ma/docs](https://numra.ma/docs).

## Licence

MIT
