import express from 'express';
import { Numra, createHandlers } from '@numra/core';

/* ═══════════════════════════════════════════════════════════════════════════
   @numra/express — the endpoint the browser packages talk to
   ───────────────────────────────────────────────────────────────────────────
   The browser half of this family (@numra/react and friends) deliberately
   cannot reach api.numra.ma: a key in a bundle reads a shared fraud ledger.
   They call the merchant's own backend instead — and this router IS that
   backend. Mount it, and @numra/react works with no glue.

       app.use('/api/numra', numraRouter({ apiKey, authorize }));

   The decisions — deny by default, what the browser may see, how an upstream
   failure is translated — all live in @numra/core's createHandlers, shared
   with the Fastify, Next and Nuxt packages. Four copies of "deny by default"
   is four chances for one of them to quietly become "allow by default".
   This file is only the Express-shaped wrapper around them.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} options
 * @param {string} [options.apiKey]      Numra credential. Server-side only.
 * @param {(req) => boolean|Promise<boolean>} [options.authorize]
 *        REQUIRED in practice — the default denies everything and says so.
 * @param {string} [options.webhookSecret]   Enables POST /webhook when set.
 * @param {(event, req) => void|Promise<void>} [options.onEvent]
 * @param {object} [options.client]      A pre-built Numra, for tests.
 * @param {string} [options.baseUrl]
 */
export function numraRouter(options = {}) {
  const { apiKey, authorize, webhookSecret, onEvent, client, baseUrl } = options;

  const numra = client ?? new Numra({ apiKey, baseUrl, integration: 'express' });
  const handlers = createHandlers({
    client: numra, authorize, webhookSecret,
    usage: "app.use('/api/numra', numraRouter({ apiKey, authorize: (req) => Boolean(req.session?.user) }))",
  });

  const router = express.Router();

  /* ── The raw body problem, and the two ways out ─────────────────────────
     Signature verification needs the exact bytes received. Once ANY body
     parser has consumed the stream those bytes are gone — express.raw()
     mounted afterwards sees `req._body` already set and passes through, so
     `req.body` arrives as a parsed object and verification fails looking
     exactly like a forged signature. Which is the worst way for it to fail:
     the usual conclusion is "webhook signing is broken", followed by
     skipping verification.

     Two supported setups:
       1. Mount this router BEFORE any body parser.
       2. Keep your app-wide parser and let it hand us the buffer:
            app.use(express.json({ verify: captureRawBody }));

     Anything else gets a 500 naming the cause — see createHandlers. */
  if (webhookSecret) {
    router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : req.rawBody ?? null;
      const out = handlers.webhook(raw, req.headers);

      res.status(out.status).json(out.body);
      if (!out.event) return;

      /* Acknowledged already. Numra retries on a non-2xx, so running the
         merchant's own slow work before answering turns a slow handler into
         duplicate deliveries. */
      try {
        await onEvent?.(out.event, req);
      } catch (e) {
        console.error('[numra] onEvent threw after acknowledging:', e?.message);
      }
    });
  }

  router.use(express.json({ limit: '32kb' }));

  router.post('/check', async (req, res) => {
    const out = await handlers.check(req.body, req);
    res.status(out.status).json(out.body);
  });

  router.post('/outcome', async (req, res) => {
    const out = await handlers.outcome(req.body, req);
    res.status(out.status).json(out.body);
  });

  return router;
}

/**
 * Retain the raw body for signature verification when an app-wide parser runs
 * first:  `app.use(express.json({ verify: captureRawBody }))`.
 *
 * The alternative is mounting numraRouter() before any parser. Either works;
 * doing neither is the case the router reports explicitly rather than letting
 * it look like a bad signature.
 */
export function captureRawBody(req, _res, buf) {
  if (buf?.length) req.rawBody = Buffer.from(buf);
}

export { Numra, NumraError } from '@numra/core';
