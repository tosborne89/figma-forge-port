import type { AsyncEvent } from '@forge/events';

import type { SyncJob } from '../domain/sync-job';
import { figmaClient, FigmaOAuthNotPortedError } from '../figma/figma-client';

// Replaces handleFigmaFileUpdateEvent, which the Connect app ran with setImmediate.
// Runs up to 900 s (timeoutSeconds in the manifest) instead of inside the HTTP request.
export async function figmaSyncHandler(event: AsyncEvent): Promise<void> {
  const job = event.body as SyncJob;

  try {
    await figmaClient.syncFile(job.fileKey);
  } catch (e) {
    if (e instanceof FigmaOAuthNotPortedError) {
      // Expected until the OAuth port lands. Not rethrown, so the queue doesn't retry.
      console.warn('figma-sync skipped', { job, reason: e.message });

      return;
    }

    throw e;
  }
}
