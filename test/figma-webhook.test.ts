import { describe, expect, it, vi } from 'vitest';

import { createFigmaWebhookHandler } from '../src/handlers/figma-webhook';
import type { SyncJob } from '../src/domain/sync-job';
import type { WebhookRegistry } from '../src/storage/registry';

const TEAM = { webhookId: 'team-hook', passcode: 'team-secret', teamId: 'T1', teamName: 'Design', adminAccountId: 'acc-1' };

const FILE_HOOK = { webhookId: 'file-hook', passcode: 'file-secret', fileKey: 'F1', eventType: 'FILE_UPDATE' as const, creatorAccountId: 'acc-2' };

function registry(): WebhookRegistry {
  return {
    findTeamByWebhookId: async (id) => (id === TEAM.webhookId ? TEAM : undefined),
    findFileWebhookByWebhookId: async (id) => (id === FILE_HOOK.webhookId ? FILE_HOOK : undefined),
  };
}

function request(body: unknown, userPath = '') {
  return { method: 'POST', path: '/x1/abc' + userPath, userPath, body: JSON.stringify(body) };
}

function setup(push = vi.fn(async (_job: SyncJob) => undefined)) {
  const handler = createFigmaWebhookHandler({ registry: registry(), enqueue: push });

  return { handler, push };
}

describe('team webhook (userPath "")', () => {
  it('queues a sync for FILE_UPDATE and answers 200 at once', async () => {
    const { handler, push } = setup();

    const res = await handler(request({ event_type: 'FILE_UPDATE', webhook_id: 'team-hook', passcode: 'team-secret', file_key: 'F9', file_name: 'x', timestamp: 't' }));

    expect(res.statusCode).toBe(200);

    expect(push).toHaveBeenCalledWith({ source: 'team', webhookId: 'team-hook', fileKey: 'F9', eventType: 'FILE_UPDATE' });
  });

  it('answers 200 to PING without queueing', async () => {
    const { handler, push } = setup();

    const res = await handler(request({ event_type: 'PING', webhook_id: 'team-hook', passcode: 'team-secret', timestamp: 't' }));

    expect(res.statusCode).toBe(200);

    expect(push).not.toHaveBeenCalled();
  });

  it('ignores DEV_MODE_STATUS_UPDATE on a team webhook, as the Connect app did', async () => {
    const { handler, push } = setup();

    const res = await handler(request({ event_type: 'DEV_MODE_STATUS_UPDATE', webhook_id: 'team-hook', passcode: 'team-secret', file_key: 'F9', status: 'READY' }));

    expect(res.statusCode).toBe(200);

    expect(push).not.toHaveBeenCalled();
  });
});

describe('file webhook (userPath "/file")', () => {
  it.each(['FILE_UPDATE', 'DEV_MODE_STATUS_UPDATE'])('queues a sync for %s', async (eventType) => {
    const { handler, push } = setup();

    const body = eventType === 'FILE_UPDATE'
      ? { event_type: eventType, webhook_id: 'file-hook', passcode: 'file-secret', file_key: 'F1', file_name: 'x', timestamp: 't' }
      : { event_type: eventType, webhook_id: 'file-hook', passcode: 'file-secret', file_key: 'F1', status: 'READY' };

    const res = await handler(request(body, '/file'));

    expect(res.statusCode).toBe(200);

    expect(push).toHaveBeenCalledWith({ source: 'file', webhookId: 'file-hook', fileKey: 'F1', eventType });
  });

  it('does not accept a team webhook id on the file path', async () => {
    const { handler } = setup();

    const res = await handler(request({ event_type: 'FILE_UPDATE', webhook_id: 'team-hook', passcode: 'team-secret', file_key: 'F1', file_name: 'x', timestamp: 't' }, '/file'));

    expect(res.statusCode).toBe(400);
  });
});

describe('authentication and validation (Figma asks for 400 on these)', () => {
  it('rejects a wrong passcode', async () => {
    const { handler, push } = setup();

    const res = await handler(request({ event_type: 'FILE_UPDATE', webhook_id: 'team-hook', passcode: 'nope', file_key: 'F1', file_name: 'x', timestamp: 't' }));

    expect(res.statusCode).toBe(400);

    expect(push).not.toHaveBeenCalled();
  });

  it('rejects an unknown webhook id', async () => {
    const { handler } = setup();

    const res = await handler(request({ event_type: 'PING', webhook_id: 'who', passcode: 'team-secret', timestamp: 't' }));

    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['not JSON', '{oops'],
    ['missing passcode', JSON.stringify({ event_type: 'PING', webhook_id: 'team-hook', timestamp: 't' })],
    ['FILE_UPDATE without file_key', JSON.stringify({ event_type: 'FILE_UPDATE', webhook_id: 'team-hook', passcode: 'team-secret', file_name: 'x', timestamp: 't' })],
    ['unknown event type', JSON.stringify({ event_type: 'LIBRARY_PUBLISH', webhook_id: 'team-hook', passcode: 'team-secret' })],
  ])('rejects a body that is %s', async (_label, raw) => {
    const { handler, push } = setup();

    const res = await handler({ method: 'POST', path: '/x1/abc', userPath: '', body: raw });

    expect(res.statusCode).toBe(400);

    expect(push).not.toHaveBeenCalled();
  });

  it('rejects an unknown path', async () => {
    const { handler } = setup();

    const res = await handler(request({ event_type: 'PING', webhook_id: 'team-hook', passcode: 'team-secret', timestamp: 't' }, '/other'));

    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-POST method', async () => {
    const { handler } = setup();

    const res = await handler({ method: 'GET', path: '/x1/abc', userPath: '' });

    expect(res.statusCode).toBe(405);
  });
});

describe('queue failure', () => {
  it('answers 500 so Figma retries (the Connect app lost these events)', async () => {
    const { handler } = setup(vi.fn(async () => {
      throw new Error('queue down');
    }));

    const res = await handler(request({ event_type: 'FILE_UPDATE', webhook_id: 'team-hook', passcode: 'team-secret', file_key: 'F1', file_name: 'x', timestamp: 't' }));

    expect(res.statusCode).toBe(500);
  });
});
