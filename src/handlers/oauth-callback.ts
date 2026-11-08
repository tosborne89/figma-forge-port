// Replaces the Connect route GET /figma/oauth/callback. A separate web trigger from the
// Figma webhook one, so that handler keeps rejecting everything but POST.
//
// Forge passes query parameters as arrays. The response pages are static text: nothing
// from the request is echoed back, so there is no reflected-XSS surface.

type CallbackRequest = {
  readonly method: string;
  readonly queryParameters?: Record<string, string[] | undefined>;
};

type CallbackResponse = {
  readonly statusCode: number;
  readonly headers: Record<string, string[]>;
  readonly body: string;
};

type Deps = {
  readonly auth: { handleCallback(code: string, state: string, redirectUri: string): Promise<string> };
  readonly redirectUri: () => Promise<string>;
};

function page(statusCode: number, title: string, message: string): CallbackResponse {
  return {
    statusCode,
    headers: { 'Content-Type': ['text/html; charset=utf-8'], 'Cache-Control': ['no-store'] },
    body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
  };
}

export function createOAuthCallbackHandler({ auth, redirectUri }: Deps) {
  return async (request: CallbackRequest): Promise<CallbackResponse> => {
    if (request.method !== 'GET') {
      return page(405, 'Method not allowed', 'This address only accepts the Figma sign-in redirect.');
    }

    const code = request.queryParameters?.code?.[0];

    const state = request.queryParameters?.state?.[0];

    if (!code || !state) {
      return page(400, 'Figma sign-in failed', 'The redirect from Figma was incomplete. Start again from the app page in Jira.');
    }

    try {
      await auth.handleCallback(code, state, await redirectUri());
    } catch (e) {
      console.warn('figma-oauth-callback failed', { reason: (e as Error).message });

      return page(400, 'Figma sign-in failed', 'The sign-in link was invalid or expired. Start again from the app page in Jira.');
    }

    return page(200, 'Figma connected', 'You can close this tab and refresh the app page in Jira.');
  };
}
