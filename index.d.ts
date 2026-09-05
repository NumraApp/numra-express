import type { Router, Request, Response } from 'express';
import type { Numra, NumraError } from '@getnumra/core';

export interface NumraRouterOptions {
  /** Numra credential. Server-side only. */
  apiKey?: string;
  /**
   * Runs before every lookup. Return false to reject.
   *
   * REQUIRED. The default denies everything and logs why — this route spends
   * your Numra quota, so leaving it open is an open relay pointed at your
   * own bill.
   */
  authorize?: (req: Request) => boolean | Promise<boolean>;
  /** Enables POST /webhook when set. */
  webhookSecret?: string;
  onEvent?: (event: Record<string, unknown>, req: Request) => void | Promise<void>;
  /** A pre-built client, for tests. */
  client?: Numra;
  baseUrl?: string;
}

/** What the browser receives — a subset. Never `raw`, never engine internals. */
export interface BrowserCheck {
  phone: string;
  verdict: string;
  riskLevel: string;
  riskScore: number;
  trustScore: number;
  confidence: number;
  isRated: boolean;
  isBlacklisted: boolean;
  customerStyle: { code: string; label: string; icon: string; color: string; riskSensitivity: number } | null;
}

export declare function numraRouter(options?: NumraRouterOptions): Router;

/**
 * Retain the raw body for signature verification when an app-wide parser
 * runs first: `app.use(express.json({ verify: captureRawBody }))`.
 */
export declare function captureRawBody(req: Request, res: Response, buf: Buffer): void;

export { Numra, NumraError } from '@getnumra/core';
