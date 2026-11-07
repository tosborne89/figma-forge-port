import { Queue } from '@forge/events';

import { figmaClient } from './figma/figma-client';
import { createFigmaWebhookHandler } from './handlers/figma-webhook';
import { createPreUninstallHandler, onInstalledHandler } from './handlers/lifecycle';
import { kvsRegistry } from './storage/registry';

export { adminResolver } from './handlers/admin-resolver';
export { figmaSyncHandler as figmaSync } from './handlers/figma-sync';

const syncQueue = new Queue({ key: 'figma-sync' });

export const figmaWebhook = createFigmaWebhookHandler({
  registry: kvsRegistry,
  enqueue: (job) => syncQueue.push({ body: job }),
});

export const onInstalled = onInstalledHandler;

export const onPreUninstall = createPreUninstallHandler({
  listWebhooks: () => kvsRegistry.listAllWebhooks(),
  deleteFigmaWebhook: (hook) => figmaClient.deleteWebhook(hook.webhookId, hook.ownerAccountId),
  deleteLocalData: () => kvsRegistry.deleteAll(),
});
