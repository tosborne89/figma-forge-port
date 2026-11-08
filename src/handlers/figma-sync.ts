import type { AsyncEvent } from '@forge/events';

import type { SyncJob } from '../domain/sync-job';
import { FigmaNotConnectedError } from '../figma/figma-auth';
import type { WebhookRegistry } from '../storage/registry';

type Deps = {
  readonly registry: WebhookRegistry;
  readonly figma: { getFileSummary(accountId: string, fileKey: string): Promise<{ name: string; lastModified: string }> };
};

// Replaces handleFigmaFileUpdateEvent, which the Connect app ran with setImmediate.
// Runs up to 900 s (timeoutSeconds in the manifest) with no user present, using the
// stored token of whoever connected the team or created the file webhook.
export function createFigmaSyncHandler({ registry, figma }: Deps) {
  return async (event: AsyncEvent): Promise<void> => {
    const job = event.body as SyncJob;

    const ownerAccountId = job.source === 'team'
      ? (await registry.findTeamByWebhookId(job.webhookId))?.adminAccountId
      : (await registry.findFileWebhookByWebhookId(job.webhookId))?.creatorAccountId;

    if (ownerAccountId === undefined) {
      console.warn('figma-sync dropped: webhook no longer registered', { job });

      return;
    }

    try {
      const file = await figma.getFileSummary(ownerAccountId, job.fileKey);

      console.info('figma-sync read file', { fileKey: job.fileKey, name: file.name, lastModified: file.lastModified });
    } catch (e) {
      if (e instanceof FigmaNotConnectedError) {
        // Retrying will not help until the owner reconnects, so the queue is not asked to.
        console.warn('figma-sync dropped: owner has no valid Figma token', { job });

        return;
      }

      throw e;
    }
  };
}
