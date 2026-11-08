import { describe, expect, it, vi } from 'vitest';

import { createFigmaSyncHandler } from '../src/handlers/figma-sync';
import { FigmaNotConnectedError } from '../src/figma/figma-auth';
import type { WebhookRegistry } from '../src/storage/registry';

const TEAM = { webhookId: 'team-hook', passcode: 'p', teamId: 'T1', teamName: 'Design', adminAccountId: 'acc-admin' };

const FILE_HOOK = { webhookId: 'file-hook', passcode: 'p', fileKey: 'F1', eventType: 'FILE_UPDATE' as const, creatorAccountId: 'acc-creator' };

const registry: WebhookRegistry = {
  findTeamByWebhookId: async (id) => (id === TEAM.webhookId ? TEAM : undefined),
  findFileWebhookByWebhookId: async (id) => (id === FILE_HOOK.webhookId ? FILE_HOOK : undefined),
};

function setup(getFileSummary = vi.fn(async () => ({ name: 'Checkout', lastModified: 't' }))) {
  return { handler: createFigmaSyncHandler({ registry, figma: { getFileSummary } }), getFileSummary };
}

const event = (body: unknown) => ({ body }) as never;

describe('figma-sync consumer', () => {
  it('reads the file as the admin who connected the team, with no user present', async () => {
    const { handler, getFileSummary } = setup();

    await handler(event({ source: 'team', webhookId: 'team-hook', fileKey: 'F9', eventType: 'FILE_UPDATE' }));

    expect(getFileSummary).toHaveBeenCalledWith('acc-admin', 'F9');
  });

  it('reads the file as the creator of a file webhook', async () => {
    const { handler, getFileSummary } = setup();

    await handler(event({ source: 'file', webhookId: 'file-hook', fileKey: 'F1', eventType: 'FILE_UPDATE' }));

    expect(getFileSummary).toHaveBeenCalledWith('acc-creator', 'F1');
  });

  it('drops the job when the webhook record is gone (team disconnected meanwhile)', async () => {
    const { handler, getFileSummary } = setup();

    await expect(handler(event({ source: 'team', webhookId: 'gone', fileKey: 'F9', eventType: 'FILE_UPDATE' }))).resolves.toBeUndefined();

    expect(getFileSummary).not.toHaveBeenCalled();
  });

  it('drops the job without retry when the owner disconnected Figma', async () => {
    const { handler } = setup(vi.fn(async () => { throw new FigmaNotConnectedError('acc-admin'); }));

    await expect(handler(event({ source: 'team', webhookId: 'team-hook', fileKey: 'F9', eventType: 'FILE_UPDATE' }))).resolves.toBeUndefined();
  });

  it('rethrows other failures so the queue retries', async () => {
    const { handler } = setup(vi.fn(async () => { throw new Error('503'); }));

    await expect(handler(event({ source: 'team', webhookId: 'team-hook', fileKey: 'F9', eventType: 'FILE_UPDATE' }))).rejects.toThrow('503');
  });
});

describe('figma-sync consumer, dev-only manual job', () => {
  it('reads the file as the account named in the job, with no webhook record', async () => {
    const { handler, getFileSummary } = setup();

    await handler(event({ source: 'manual', ownerAccountId: 'acc-admin', fileKey: 'F5' }));

    expect(getFileSummary).toHaveBeenCalledWith('acc-admin', 'F5');
  });
});
