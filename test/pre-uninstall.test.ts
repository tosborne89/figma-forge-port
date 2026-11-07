import { describe, expect, it, vi } from 'vitest';

import { createPreUninstallHandler } from '../src/handlers/lifecycle';

describe('preUninstall', () => {
  it('tries to delete every Figma webhook, then deletes local data', async () => {
    const calls: string[] = [];

    const handler = createPreUninstallHandler({
      listWebhooks: async () => [
        { webhookId: 'team-hook', ownerAccountId: 'acc-1' },
        { webhookId: 'file-hook', ownerAccountId: 'acc-2' },
      ],
      deleteFigmaWebhook: async (hook) => {
        calls.push('figma:' + hook.webhookId);
      },
      deleteLocalData: async () => {
        calls.push('local');
      },
    });

    await handler();

    expect(calls).toEqual(['figma:team-hook', 'figma:file-hook', 'local']);
  });

  it('still deletes local data when a Figma deletion fails (Promise.allSettled, as before)', async () => {
    const deleteLocalData = vi.fn(async () => undefined);

    const handler = createPreUninstallHandler({
      listWebhooks: async () => [{ webhookId: 'team-hook', ownerAccountId: 'acc-1' }],
      deleteFigmaWebhook: async () => {
        throw new Error('Figma 401');
      },
      deleteLocalData,
    });

    await handler();

    expect(deleteLocalData).toHaveBeenCalledOnce();
  });
});
