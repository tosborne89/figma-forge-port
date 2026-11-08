import { createHash, randomBytes } from 'node:crypto';

import { createState, verifyState } from './oauth-state';

// Ports FigmaAuthService and the FigmaOAuth2UserCredentials table.
//
// Why not Forge's built-in external auth (withProvider)? It only works in functions a
// user invokes from the UI. This app needs Figma tokens in the queue consumer and in
// preUninstall, where no user is present, so it keeps its own OAuth code: tokens in
// Forge secret storage, refresh through plain fetch to declared egress.

export type HttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

// The subset of @forge/kvs this module needs, so tests can use a Map.
export type SecretStore = {
  getSecret(key: string): Promise<unknown>;
  setSecret(key: string, value: unknown): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

export type FigmaAuthConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly stateKey: string;
};

type Credentials = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly figmaUserId: string;
};

type PendingAuthorization = {
  readonly verifier: string;
  readonly accountId: string;
  readonly redirectUri: string;
};

export class FigmaNotConnectedError extends Error {
  constructor(accountId: string, reason = 'no stored Figma credentials') {
    super(`Figma not connected for ${accountId}: ${reason}`);
  }
}

export class FigmaOAuthError extends Error {}

// projects:read in the Connect app is deprecated; folders:read replaces it.
export const FIGMA_SCOPES = [
  'current_user:read',
  'file_content:read',
  'file_metadata:read',
  'folders:read',
  'webhooks:read',
  'webhooks:write',
].join(' ');

const AUTHORIZE_URL = 'https://www.figma.com/oauth';

const TOKEN_URL = 'https://api.figma.com/v1/oauth/token';

const REFRESH_URL = 'https://api.figma.com/v1/oauth/refresh';

// Same margin as the Connect app's TOKEN_EXPIRATION_OFFSET.
const REFRESH_MARGIN_MS = 60 * 60_000;

export const CREDENTIALS_PREFIX = 'figma-cred:';

// Secrets cannot be queried by prefix, so a non-secret index lets uninstall find them.
export const CREDENTIALS_INDEX_PREFIX = 'figma-cred-index:';

const PENDING_PREFIX = 'figma-oauth-pending:';

type Deps = {
  readonly fetch: HttpFetch;
  readonly store: SecretStore;
  readonly config: () => FigmaAuthConfig;
  readonly now?: () => number;
};

export function createFigmaAuth({ fetch, store, config, now = Date.now }: Deps) {
  function basicAuth(): string {
    const { clientId, clientSecret } = config();

    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
      body: new URLSearchParams(form).toString(),
    });

    if (!response.ok) {
      throw new FigmaOAuthError(`Figma OAuth endpoint answered ${response.status}`);
    }

    const body = await response.json();

    if (typeof body !== 'object' || body === null) {
      throw new FigmaOAuthError('Figma OAuth endpoint returned no JSON object');
    }

    return body as Record<string, unknown>;
  }

  function readTokenFields(body: Record<string, unknown>): { accessToken: string; expiresIn: number } {
    const { access_token: accessToken, expires_in: expiresIn } = body;

    if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
      throw new FigmaOAuthError('Figma OAuth response is missing access_token or expires_in');
    }

    return { accessToken, expiresIn };
  }

  async function saveCredentials(accountId: string, credentials: Credentials): Promise<void> {
    await store.setSecret(CREDENTIALS_PREFIX + accountId, credentials);

    await store.set(CREDENTIALS_INDEX_PREFIX + accountId, { accountId });
  }

  return {
    async buildAuthorizationUrl(accountId: string, redirectUri: string): Promise<string> {
      const nonce = randomBytes(16).toString('base64url');

      const verifier = randomBytes(32).toString('base64url');

      const pending: PendingAuthorization = { verifier, accountId, redirectUri };

      await store.setSecret(PENDING_PREFIX + nonce, pending);

      const url = new URL(AUTHORIZE_URL);

      url.search = new URLSearchParams({
        client_id: config().clientId,
        redirect_uri: redirectUri,
        scope: FIGMA_SCOPES,
        state: createState({ accountId, nonce }, config().stateKey, now()),
        response_type: 'code',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();

      return url.toString();
    },

    // Runs inside the callback web trigger: Figma's code expires 30 s after issue,
    // so the exchange cannot be queued.
    async handleCallback(code: string, state: string, redirectUri: string): Promise<string> {
      const claims = verifyState(state, config().stateKey, now());

      if (claims === undefined) {
        throw new FigmaOAuthError('Invalid or expired state');
      }

      const pendingKey = PENDING_PREFIX + claims.nonce;

      const pending = (await store.getSecret(pendingKey)) as PendingAuthorization | undefined;

      await store.deleteSecret(pendingKey);

      if (pending === undefined || pending.accountId !== claims.accountId) {
        throw new FigmaOAuthError('Unknown or already used state');
      }

      if (pending.redirectUri !== redirectUri) {
        throw new FigmaOAuthError('Callback arrived on a different redirect URI');
      }

      const body = await postForm(TOKEN_URL, {
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code',
        code_verifier: pending.verifier,
      });

      const { accessToken, expiresIn } = readTokenFields(body);

      const { refresh_token: refreshToken, user_id_string: figmaUserId } = body;

      if (typeof refreshToken !== 'string') {
        throw new FigmaOAuthError('Figma token response has no refresh_token');
      }

      await saveCredentials(claims.accountId, {
        accessToken,
        refreshToken,
        expiresAt: now() + expiresIn * 1000,
        figmaUserId: typeof figmaUserId === 'string' ? figmaUserId : '',
      });

      return claims.accountId;
    },

    // Works with no user present (queue consumer, preUninstall), which is the point of the port.
    async getAccessToken(accountId: string): Promise<string> {
      const stored = (await store.getSecret(CREDENTIALS_PREFIX + accountId)) as Credentials | undefined;

      if (stored === undefined) {
        throw new FigmaNotConnectedError(accountId);
      }

      if (now() < stored.expiresAt - REFRESH_MARGIN_MS) {
        return stored.accessToken;
      }

      let body: Record<string, unknown>;

      try {
        body = await postForm(REFRESH_URL, { refresh_token: stored.refreshToken });
      } catch (e) {
        throw new FigmaNotConnectedError(accountId, `refresh failed (${(e as Error).message})`);
      }

      const { accessToken, expiresIn } = readTokenFields(body);

      // Figma's refresh response carries no new refresh token; the old one stays valid.
      await saveCredentials(accountId, { ...stored, accessToken, expiresAt: now() + expiresIn * 1000 });

      return accessToken;
    },

    async isConnected(accountId: string): Promise<boolean> {
      return (await store.getSecret(CREDENTIALS_PREFIX + accountId)) !== undefined;
    },

    async disconnect(accountId: string): Promise<void> {
      await store.deleteSecret(CREDENTIALS_PREFIX + accountId);

      await store.delete(CREDENTIALS_INDEX_PREFIX + accountId);
    },
  };
}

export type FigmaAuth = ReturnType<typeof createFigmaAuth>;
