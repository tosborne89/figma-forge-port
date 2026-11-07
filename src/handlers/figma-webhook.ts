import { parseFigmaWebhookEvent } from '../domain/figma-webhook-event';
import { passcodesMatch } from '../domain/passcode';
import type { SyncJob } from '../domain/sync-job';
import type { WebhookRegistry } from '../storage/registry';

export type WebTriggerRequest = {
  readonly method: string;
  readonly path: string;
  readonly userPath: string;
  readonly body?: string;
};

export type WebTriggerResponse = {
  readonly statusCode: number;
  readonly body?: string;
};

type Deps = {
  readonly registry: WebhookRegistry;
  readonly enqueue: (job: SyncJob) => Promise<unknown>;
};

const ok: WebTriggerResponse = { statusCode: 200 };

const badRequest: WebTriggerResponse = { statusCode: 400, body: 'Unknown webhook.' };

// One web trigger replaces the Connect routes POST /figma/webhook (team) and
// POST /figma/webhook/file. Figma retries 5xx at 5, 30 and 180 minutes and asks
// for 400 on authentication failure, so those codes are kept.
export function createFigmaWebhookHandler({ registry, enqueue }: Deps) {
  return async (request: WebTriggerRequest): Promise<WebTriggerResponse> => {
    if (request.method !== 'POST') {
      return { statusCode: 405 };
    }

    const source = request.userPath === '' ? 'team' : request.userPath === '/file' ? 'file' : undefined;

    if (source === undefined) {
      return { statusCode: 404 };
    }

    const event = parseFigmaWebhookEvent(request.body);

    if (event === undefined) {
      return { statusCode: 400, body: 'Cannot authenticate a webhook.' };
    }

    const stored = source === 'team'
      ? await registry.findTeamByWebhookId(event.webhook_id)
      : await registry.findFileWebhookByWebhookId(event.webhook_id);

    if (stored === undefined || !passcodesMatch(stored.passcode, event.passcode)) {
      return badRequest;
    }

    const syncable = event.event_type === 'FILE_UPDATE'
      || (source === 'file' && event.event_type === 'DEV_MODE_STATUS_UPDATE');

    if (!syncable) {
      return ok;
    }

    try {
      await enqueue({ source, webhookId: event.webhook_id, fileKey: event.file_key, eventType: event.event_type });
    } catch {
      return { statusCode: 500 };
    }

    return ok;
  };
}
