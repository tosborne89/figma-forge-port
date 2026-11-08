import { describe, expect, it, vi } from 'vitest';

import { createOAuthCallbackHandler } from '../src/handlers/oauth-callback';

const REDIRECT = 'https://abc.hello.atlassian-dev.net/x1/callback';

function request(queryParameters: Record<string, string[]>, method = 'GET') {
  return { method, queryParameters };
}

function setup(handleCallback = vi.fn(async () => 'acc-1')) {
  const handler = createOAuthCallbackHandler({ auth: { handleCallback }, redirectUri: async () => REDIRECT });

  return { handler, handleCallback };
}

describe('Figma OAuth callback web trigger', () => {
  it('completes the flow and answers with a static HTML page', async () => {
    const { handler, handleCallback } = setup();

    const res = await handler(request({ code: ['c1'], state: ['s1'] }));

    expect(handleCallback).toHaveBeenCalledWith('c1', 's1', REDIRECT);

    expect(res.statusCode).toBe(200);

    expect(res.headers['Content-Type']).toEqual(['text/html; charset=utf-8']);

    expect(res.body).toContain('Figma connected');
  });

  it('answers 405 to anything but GET', async () => {
    const { handler, handleCallback } = setup();

    expect((await handler(request({ code: ['c1'], state: ['s1'] }, 'POST'))).statusCode).toBe(405);

    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('answers 400 when code or state is missing', async () => {
    const { handler, handleCallback } = setup();

    expect((await handler(request({ state: ['s1'] }))).statusCode).toBe(400);

    expect((await handler(request({ code: ['c1'] }))).statusCode).toBe(400);

    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('answers 400 and does not echo input when the flow fails', async () => {
    const { handler } = setup(vi.fn(async () => { throw new Error('Invalid or expired state'); }));

    const res = await handler(request({ code: ['<script>x</script>'], state: ['<b>s</b>'] }));

    expect(res.statusCode).toBe(400);

    expect(res.body).not.toContain('<script>x');

    expect(res.body).not.toContain('<b>s');
  });
});
