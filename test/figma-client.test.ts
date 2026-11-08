import { describe, expect, it, vi } from 'vitest';

import { createFigmaClient, FigmaApiError, PaidPlanRequiredError } from '../src/figma/figma-client';
import type { HttpFetch } from '../src/figma/figma-auth';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function setup(response: ReturnType<typeof jsonResponse>) {
  const fetch = vi.fn<HttpFetch>(async () => response);

  const getAccessToken = vi.fn(async (_accountId: string) => 'at-1');

  return { client: createFigmaClient({ fetch, auth: { getAccessToken } }), fetch, getAccessToken };
}

describe('figma client', () => {
  it('reads the current user with the stored token of the given account', async () => {
    const { client, fetch, getAccessToken } = setup(jsonResponse(200, { id: 'u1', email: 'a@b.c', handle: 'A' }));

    expect(await client.getMe('acc-1')).toEqual({ email: 'a@b.c', handle: 'A' });

    expect(getAccessToken).toHaveBeenCalledWith('acc-1');

    expect(fetch.mock.calls[0]![0]).toBe('https://api.figma.com/v1/me');

    expect(fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer at-1');
  });

  it('reads a file summary at depth 1 with the file key encoded', async () => {
    const { client, fetch } = setup(jsonResponse(200, { name: 'Checkout', lastModified: '2026-11-08T10:00:00Z', document: {} }));

    expect(await client.getFileSummary('acc-1', 'a/b')).toEqual({ name: 'Checkout', lastModified: '2026-11-08T10:00:00Z' });

    expect(fetch.mock.calls[0]![0]).toBe('https://api.figma.com/v1/files/a%2Fb?depth=1');
  });

  it('creates a FILE_UPDATE team webhook with the given endpoint and passcode', async () => {
    const { client, fetch } = setup(jsonResponse(200, { id: 'wh-1', context_id: 'T1' }));

    expect(await client.createTeamWebhook('acc-1', { teamId: 'T1', endpoint: 'https://x/wt', passcode: 'p' })).toEqual({ webhookId: 'wh-1', teamId: 'T1' });

    const [url, init] = fetch.mock.calls[0]!;

    expect(url).toBe('https://api.figma.com/v2/webhooks');

    expect(init.method).toBe('POST');

    expect(JSON.parse(init.body ?? '')).toMatchObject({ event_type: 'FILE_UPDATE', context: 'team', context_id: 'T1', endpoint: 'https://x/wt', passcode: 'p' });
  });

  it('maps 400 "Access Denied" on webhook create to PaidPlanRequiredError', async () => {
    const { client } = setup(jsonResponse(400, { status: 400, err: true, message: 'Access Denied' }));

    await expect(client.createTeamWebhook('acc-1', { teamId: 'T1', endpoint: 'e', passcode: 'p' })).rejects.toBeInstanceOf(PaidPlanRequiredError);
  });

  it('deletes a webhook and treats 404 as already gone', async () => {
    const { client, fetch } = setup(jsonResponse(404, { message: 'Not found' }));

    await expect(client.deleteWebhook('acc-1', 'wh-1')).resolves.toBeUndefined();

    expect(fetch.mock.calls[0]![0]).toBe('https://api.figma.com/v2/webhooks/wh-1');

    expect(fetch.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('raises FigmaApiError with the status for other failures', async () => {
    const { client } = setup(jsonResponse(403, { message: 'Forbidden' }));

    await expect(client.getMe('acc-1')).rejects.toMatchObject({ status: 403 });

    await expect(client.getMe('acc-1')).rejects.toBeInstanceOf(FigmaApiError);
  });
});
