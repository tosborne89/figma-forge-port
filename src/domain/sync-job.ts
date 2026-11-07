// The unit of work a Figma webhook produces. The Connect app ran this inline with
// setImmediate and no retry; here it goes on a Forge Async Events queue.
export type SyncJob = {
  readonly source: 'team' | 'file';
  readonly webhookId: string;
  readonly fileKey: string;
  readonly eventType: 'FILE_UPDATE' | 'DEV_MODE_STATUS_UPDATE';
};
