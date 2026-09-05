import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createHmac } from 'node:crypto';
import { Numra } from '@getnumra/core';
import { numraRouter } from '../src/index.js';
import { startMockServer, LOOKUP_OK } from './mock-server.js';

/* Boots the merchant's app on a real socket in front of a fake Numra, so the
   whole path — browser → merchant backend → Numra — is exercised. */
async function app(routerOpts = {}, handler = () => ({ body: LOOKUP_OK })) {
  const upstream = await startMockServer(handler);
  const a = express();
  a.use('/api/numra', numraRouter({
    client: new Numra({ apiKey: 'k', baseUrl: upstream.url, maxRetries: 0 }),
    ...routerOpts,
  }));
  const server = await new Promise((r) => {
    const s = http.createServer(a).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, upstream,
    post: (p, body, headers) => fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await upstream.close();
    },
  };
}

test('with no authorize, the router refuses and spends nothing', async () => {
  /* The default MUST deny. An SDK whose default is "allow" ships an open
     relay pointed at the merchant's paid quota to everyone who skims the
     README. */
  const a = await app();
  const res = await a.post('/api/numra/check', { phone: '0600000000' });

  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'NUMRA_NOT_CONFIGURED');
  assert.equal(a.upstream.calls.length, 0, 'must not reach Numra');
  await a.close();
});

test('a failing authorize is 403 and spends nothing', async () => {
  const a = await app({ authorize: () => false });
  const res = await a.post('/api/numra/check', { phone: '0600000000' });
  assert.equal(res.status, 403);
  assert.equal(a.upstream.calls.length, 0);
  await a.close();
});

test('an authorize that throws denies rather than allowing', async () => {
  /* Fail closed. A session lookup that throws must not become an open door. */
  const a = await app({ authorize: () => { throw new Error('db down'); } });
  const res = await a.post('/api/numra/check', { phone: '0600000000' });
  assert.equal(res.status, 403);
  assert.equal(a.upstream.calls.length, 0);
  await a.close();
});

test('an authorized check reaches Numra and returns the browser subset', async () => {
  const a = await app({ authorize: () => true });
  const res = await a.post('/api/numra/check', { phone: '0600000000' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.riskLevel, 'HIGH');
  assert.equal(body.isRated, true);
  /* The browser gets a subset. `raw` would leak the shape of our ledger and
     `risk_score_raw` is engine diagnostics. */
  assert.equal(body.raw, undefined);
  assert.equal(body.risk_score_raw, undefined);
  assert.equal(a.upstream.calls.length, 1);
  await a.close();
});

test('a bad credential is never relayed to the browser as 401', async () => {
  /* The merchant's credential problem is not the visitor's business, and a
     401 in the browser reads as "you are logged out". */
  const a = await app(
    { authorize: () => true },
    () => ({ status: 401, body: { ok: false, error: 'LICENSE_EXPIRED', message: 'expired' } }),
  );
  const res = await a.post('/api/numra/check', { phone: '0600000000' });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'UPSTREAM_UNAVAILABLE');
  await a.close();
});
