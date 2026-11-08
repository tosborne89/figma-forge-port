import api, { webTrigger } from '@forge/api';
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';

import { createFigmaAuth, type FigmaAuthConfig, type HttpFetch } from './figma/figma-auth';
import { createFigmaClient } from './figma/figma-client';
import { createAdminResolver } from './handlers/admin-resolver';
import { createFigmaSyncHandler } from './handlers/figma-sync';
import { createFigmaWebhookHandler } from './handlers/figma-webhook';
import { createPreUninstallHandler, onInstalledHandler } from './handlers/lifecycle';
import { createOAuthCallbackHandler } from './handlers/oauth-callback';
import { kvsRegistry } from './storage/registry';

// Set with `forge variables set --encrypt` per environment; never committed.
function figmaConfig(): FigmaAuthConfig {
  const { FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET, FIGMA_STATE_KEY } = process.env;

  if (!FIGMA_CLIENT_ID || !FIGMA_CLIENT_SECRET || !FIGMA_STATE_KEY || FIGMA_STATE_KEY.length < 32) {
    throw new Error('Set FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET and FIGMA_STATE_KEY (32+ chars) with forge variables set --encrypt');
  }

  return { clientId: FIGMA_CLIENT_ID, clientSecret: FIGMA_CLIENT_SECRET, stateKey: FIGMA_STATE_KEY };
}

// Egress goes through Forge fetch, limited to the hosts in permissions.external.fetch.backend.
const forgeFetch: HttpFetch = (url, init) => api.fetch(url, init);

const auth = createFigmaAuth({ fetch: forgeFetch, store: kvs, config: figmaConfig });

const figma = createFigmaClient({ fetch: forgeFetch, auth });

// Stable per site, app and environment, so it is the redirect URI registered in Figma.
const redirectUri = () => webTrigger.getUrl('figma-oauth-callback');

const syncQueue = new Queue({ key: 'figma-sync' });

export const adminResolver = createAdminResolver({
  auth,
  figma,
  registry: kvsRegistry,
  redirectUri,
  webhookEndpoint: () => webTrigger.getUrl('figma-webhook'),
});

export const figmaOAuthCallback = createOAuthCallbackHandler({ auth, redirectUri });

export const figmaWebhook = createFigmaWebhookHandler({
  registry: kvsRegistry,
  enqueue: (job) => syncQueue.push({ body: job }),
});

export const figmaSync = createFigmaSyncHandler({ registry: kvsRegistry, figma });

export const onInstalled = onInstalledHandler;

export const onPreUninstall = createPreUninstallHandler({
  listWebhooks: () => kvsRegistry.listAllWebhooks(),
  deleteFigmaWebhook: (hook) => figma.deleteWebhook(hook.ownerAccountId, hook.webhookId),
  deleteLocalData: () => kvsRegistry.deleteAll(),
});
