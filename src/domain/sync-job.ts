// The unit of work a Figma webhook produces. The Connect app ran this inline with
// setImmediate and no retry; here it goes on a Forge Async Events queue.
export type WebhookSyncJob = {
  readonly source: 'team' | 'file';
  readonly webhookId: string;
  readonly fileKey: string;
  readonly eventType: 'FILE_UPDATE' | 'DEV_MODE_STATUS_UPDATE';
};

// Dev-only: queued from the admin page so the no-user consumer path can be shown on a
// free Figma plan, which cannot create the webhooks that normally start it.
export type ManualSyncJob = {
  readonly source: 'manual';
  readonly ownerAccountId: string;
  readonly fileKey: string;
};

export type SyncJob = WebhookSyncJob | ManualSyncJob;

// Accepts figma.com/file/<key>/..., /design/<key>/... or a bare key.
export function parseFigmaFileKey(input: string): string | undefined {
  const trimmed = input.trim();

  const match = /figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,64})(?:[/?#]|$)/.exec(trimmed);

  if (match) {
    return match[1];
  }

  return /^[A-Za-z0-9]{10,64}$/.test(trimmed) ? trimmed : undefined;
}
