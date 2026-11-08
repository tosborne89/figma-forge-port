import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createFigmaAuth, FigmaNotConnectedError, type HttpFetch, type SecretStore } from '../src/figma/figma-auth';

const CONFIG = { clientId: 'client-1', clientSecret: 'secret-1', stateKey: 'state-key-0123456789abcdef' };

const REDIRECT = 'https://abc.hello.atlassian-dev.net/x1/callback';

const NOW = 1_800_000_000_000;

function memoryStore(): SecretStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();

  return {
    data,
    getSecret: async (k) => data.get(`s:${k}`),
    setSecret: async (k, v) => { data.set(`s:${k}`, v); },
    deleteSecret: async (k) => { data.delete(`s:${k}`); },
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
  };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function setup(fetchImpl?: HttpFetch, now = () => NOW) {
  const store = memoryStore();

  const fetch = vi.fn(fetchImpl ?? (async () => jsonResponse(200, {
    user_id_string: 'figma-u1', access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7_776_000, token_type: 'bearer',
  })));

  const auth = createFigmaAuth({ fetch, store, config: () => CONFIG, now });

  return { auth, store, fetch };
}

async function startFlow(auth: ReturnType<typeof createFigmaAuth>) {
  const url = new URL(await auth.buildAuthorizationUrl('acc-1', REDIRECT));

  return { url, state: url.searchParams.get('state') ?? '' };
}

describe('buildAuthorizationUrl', () => {
  it('points at Figma with client id, redirect, scopes, state and an S256 PKCE challenge', async () => {
    const { auth } = setup();

    const { url } = await startFlow(auth);

    expect(url.origin + url.pathname).toBe('https://www.figma.com/oauth');

    expect(url.searchParams.get('client_id')).toBe('client-1');

    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);

    expect(url.searchParams.get('response_type')).toBe('code');

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    expect(url.searchParams.get('scope')).toContain('current_user:read');

    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('handleCallback', () => {
  it('exchanges the code with Basic auth, a form body and the PKCE verifier, then stores credentials', async () => {
    const { auth, fetch } = setup();

    const { url, state } = await startFlow(auth);

    const accountId = await auth.handleCallback('code-1', state, REDIRECT);

    expect(accountId).toBe('acc-1');

    const [calledUrl, init] = fetch.mock.calls[0]!;

    expect(calledUrl).toBe('https://api.figma.com/v1/oauth/token');

    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);

    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const form = new URLSearchParams(init.body);

    expect(form.get('code')).toBe('code-1');

    expect(form.get('redirect_uri')).toBe(REDIRECT);

    expect(form.get('grant_type')).toBe('authorization_code');

    const verifier = form.get('code_verifier') ?? '';

    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'));

    expect(form.has('client_secret')).toBe(false);

    expect(await auth.getAccessToken('acc-1')).toBe('at-1');
  });

  it('refuses a second callback with the same state (verifier is one-time)', async () => {
    const { auth } = setup();

    const { state } = await startFlow(auth);

    await auth.handleCallback('code-1', state, REDIRECT);

    await expect(auth.handleCallback('code-2', state, REDIRECT)).rejects.toThrow(/state/i);
  });

  it('refuses a tampered state without calling Figma', async () => {
    const { auth, fetch } = setup();

    const { state } = await startFlow(auth);

    await expect(auth.handleCallback('code-1', state.slice(0, -2) + 'xx', REDIRECT)).rejects.toThrow(/state/i);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a callback on a different redirect URI', async () => {
    const { auth } = setup();

    const { state } = await startFlow(auth);

    await expect(auth.handleCallback('code-1', state, 'https://evil.example/cb')).rejects.toThrow(/redirect/i);
  });

  it('stores nothing when Figma rejects the code', async () => {
    const { auth } = setup(async () => jsonResponse(400, { error: 'invalid_grant' }));

    const { state } = await startFlow(auth);

    await expect(auth.handleCallback('code-1', state, REDIRECT)).rejects.toThrow(/400/);

    await expect(auth.getAccessToken('acc-1')).rejects.toBeInstanceOf(FigmaNotConnectedError);
  });
});

describe('getAccessToken', () => {
  it('throws FigmaNotConnectedError for an account that never connected', async () => {
    const { auth } = setup();

    await expect(auth.getAccessToken('nobody')).rejects.toBeInstanceOf(FigmaNotConnectedError);
  });

  it('refreshes within an hour of expiry and keeps the old refresh token', async () => {
    let clock = NOW;

    const responses = [
      jsonResponse(200, { user_id_string: 'u', access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200, token_type: 'bearer' }),
      jsonResponse(200, { access_token: 'at-2', expires_in: 7200, token_type: 'bearer' }),
      jsonResponse(200, { access_token: 'at-3', expires_in: 7200, token_type: 'bearer' }),
    ];

    const { auth, fetch } = setup(async () => responses.shift()!, () => clock);

    const { state } = await startFlow(auth);

    await auth.handleCallback('code-1', state, REDIRECT);

    expect(await auth.getAccessToken('acc-1')).toBe('at-1');

    clock = NOW + 61 * 60_000;

    expect(await auth.getAccessToken('acc-1')).toBe('at-2');

    const [refreshUrl, init] = fetch.mock.calls[1]!;

    expect(refreshUrl).toBe('https://api.figma.com/v1/oauth/refresh');

    expect(new URLSearchParams(init.body).get('refresh_token')).toBe('rt-1');

    clock = NOW + 2 * 61 * 60_000;

    expect(await auth.getAccessToken('acc-1')).toBe('at-3');

    expect(new URLSearchParams(fetch.mock.calls[2]![1].body).get('refresh_token')).toBe('rt-1');
  });

  it('treats a rejected refresh as disconnected', async () => {
    let clock = NOW;

    const responses = [
      jsonResponse(200, { user_id_string: 'u', access_token: 'at-1', refresh_token: 'rt-1', expires_in: 60, token_type: 'bearer' }),
      jsonResponse(400, { error: 'invalid_grant' }),
    ];

    const { auth } = setup(async () => responses.shift()!, () => clock);

    const { state } = await startFlow(auth);

    await auth.handleCallback('code-1', state, REDIRECT);

    clock = NOW + 120_000;

    await expect(auth.getAccessToken('acc-1')).rejects.toBeInstanceOf(FigmaNotConnectedError);
  });
});

describe('disconnect', () => {
  it('removes stored credentials', async () => {
    const { auth } = setup();

    const { state } = await startFlow(auth);

    await auth.handleCallback('code-1', state, REDIRECT);

    await auth.disconnect('acc-1');

    await expect(auth.getAccessToken('acc-1')).rejects.toBeInstanceOf(FigmaNotConnectedError);
  });
});
