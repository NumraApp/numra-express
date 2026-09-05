import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createHmac } from 'node:crypto';
import { Numra } from '@getnumra/core';
import { numraRouter, captureRawBody } from '../src/index.js';
import { startMockServer, LOOKUP_OK } from './mock-server.js';

const SECRET = 'whsec_test';

/* Three ways an integrator can wire this up. Two must work; the third must
   fail in a way that names the cause instead of looking like a forgery. */
const SETUPS = {
  /** Router first — nothing has touched the stream. */
  before: (a, router) => { a.use('/api/numra', router); a.use(express.json()); },
  /** App-wide parser, but it hands us the buffer. */
  captured: (a, router) => { a.use(express.json({ verify: captureRawBody })); a.use('/api/numra', router); },
  /** App-wide parser that ate the body. Unrecoverable, by design. */
  consumed: (a, router) => { a.use(express.json()); a.use('/api/numra', router); },
};

async function app(setup, opts = {}) {
  const upstream = await startMockServer(() => ({ body: LOOKUP_OK }));
  const a = express();
  const router = numraRouter({
    client: new Numra({ apiKey: 'k', baseUrl: upstream.url }),
    authorize: () => true,
    webhookSecret: SECRET,
    ...opts,
  });
  SETUPS[setup](a, router);

  const server = await new Promise((r) => {
    const s = http.createServer(a).listen(0, '127.0.0.1', () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await upstream.close();
    },
  };
}

const body = JSON.stringify({ id: 'evt_1', event: 'verification.flagged', data: { phone: '+212600000000' } });
const sign = (b, ts) => ({
  'Numra-Signature': 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${b}`).digest('hex'),
  'Numra-Timestamp': String(ts),
  'Content-Type': 'application/json',
});
const now = () => Math.floor(Date.now() / 1000);
const send = (base, headers, b = body) =>
  fetch(base + '/api/numra/webhook', { method: 'POST', headers, body: b });

for (const setup of ['before', 'captured']) {
  test(`[${setup}] a signed webhook verifies and reaches onEvent`, async () => {
    const seen = [];
    const a = await app(setup, { onEvent: (e) => seen.push(e) });
    const res = await send(a.base, sign(body, now()));

    assert.equal(res.status, 200);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].event, 'verification.flagged');
    await a.close();
  });

  test(`[${setup}] a forged signature is 400 and the handler never runs`, async () => {
    const seen = [];
    const a = await app(setup, { onEvent: (e) => seen.push(e) });
    const res = await send(a.base, { ...sign(body, now()), 'Numra-Signature': 'sha256=deadbeef' });

    /* 400 not 401: an unauthentic sender has no credential to fix, and 401
       invites a retry storm. */
    assert.equal(res.status, 400);
    assert.equal(seen.length, 0);
    await a.close();
  });

  test(`[${setup}] a stale timestamp is rejected as a replay`, async () => {
    const a = await app(setup);
    const res = await send(a.base, sign(body, now() - 3600));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'expired');
    await a.close();
  });
}

test('[consumed] a parser that ate the body gives a 500 naming the cause', async () => {
  /* This is the case that used to fail as a 400 "invalid signature" — which
     reads as "Numra sent us a bad webhook" and ends in someone disabling
     verification. It must accuse the configuration, not the sender. */
  const a = await app('consumed');
  const res = await send(a.base, sign(body, now()));

  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'NUMRA_RAW_BODY_UNAVAILABLE');
  await a.close();
});

test('a slow handler cannot cause duplicate deliveries', async () => {
  /* Numra retries on non-2xx, so the route must acknowledge before doing the
     merchant's own work. */
  const a = await app('before', { onEvent: () => new Promise((r) => setTimeout(r, 400)) });
  const started = Date.now();
  const res = await send(a.base, sign(body, now()));

  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 300, 'acknowledged before the handler finished');
  await a.close();
});
