import { createHmac, timingSafeEqual } from 'node:crypto';

// Replaces the Connect app's state JWT (atlassian-jwt, HS256, 5 minutes). Same idea,
// no dependency: base64url(JSON payload) + "." + base64url(HMAC-SHA256 of it).
// The nonce also keys the one-time PKCE verifier, so a replayed state fails twice over.
export type OAuthStateClaims = {
  readonly accountId: string;
  readonly nonce: string;
};

const LIFETIME_MS = 5 * 60_000;

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createState(claims: OAuthStateClaims, key: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: now + LIFETIME_MS })).toString('base64url');

  return `${payload}.${sign(payload, key)}`;
}

export function verifyState(state: string, key: string, now: number): OAuthStateClaims | undefined {
  const parts = state.split('.');

  if (parts.length !== 2) {
    return undefined;
  }

  const [payload = '', signature = ''] = parts;

  const expected = Buffer.from(sign(payload, key));

  const given = Buffer.from(signature);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined;
  }

  let claims: unknown;

  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }

  if (typeof claims !== 'object' || claims === null) {
    return undefined;
  }

  const { accountId, nonce, exp } = claims as Record<string, unknown>;

  if (typeof accountId !== 'string' || typeof nonce !== 'string' || typeof exp !== 'number' || now > exp) {
    return undefined;
  }

  return { accountId, nonce };
}
