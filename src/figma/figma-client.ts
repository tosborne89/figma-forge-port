import type { HttpFetch } from './figma-auth';

// Ports the parts of FigmaClient and FigmaService this case study needs. Every call
// takes an Atlassian account id and resolves that account's stored Figma token, so it
// works from the queue consumer and preUninstall, where no user is present.

const API = 'https://api.figma.com';

export class FigmaApiError extends Error {
  constructor(readonly status: number, operation: string) {
    super(`${operation} answered ${status}`);
  }
}

// Figma only allows webhooks on paid plans and answers 400 "Access Denied" otherwise,
// the same check the Connect app's FigmaService makes.
export class PaidPlanRequiredError extends Error {
  constructor() {
    super('A paid Figma plan is required to create webhooks');
  }
}

type Deps = {
  readonly fetch: HttpFetch;
  readonly auth: { getAccessToken(accountId: string): Promise<string> };
};

export function createFigmaClient({ fetch, auth }: Deps) {
  async function call(accountId: string, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Authorization: `Bearer ${await auth.getAccessToken(accountId)}` };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function json(accountId: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await call(accountId, method, path, body);

    if (!response.ok) {
      throw new FigmaApiError(response.status, `${method} ${path}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  return {
    async getMe(accountId: string): Promise<{ email: string; handle: string }> {
      const me = await json(accountId, 'GET', '/v1/me');

      return { email: String(me.email ?? ''), handle: String(me.handle ?? '') };
    },

    // Stands in for the Connect app's design sync: proves a background call with a stored
    // token. Writing the result into Jira needs the design module Forge does not have.
    async getFileSummary(accountId: string, fileKey: string): Promise<{ name: string; lastModified: string }> {
      const file = await json(accountId, 'GET', `/v1/files/${encodeURIComponent(fileKey)}?depth=1`);

      return { name: String(file.name ?? ''), lastModified: String(file.lastModified ?? '') };
    },

    async createTeamWebhook(
      accountId: string,
      { teamId, endpoint, passcode }: { teamId: string; endpoint: string; passcode: string },
    ): Promise<{ webhookId: string; teamId: string }> {
      const path = '/v2/webhooks';

      const response = await call(accountId, 'POST', path, {
        event_type: 'FILE_UPDATE',
        context: 'team',
        context_id: teamId,
        endpoint,
        passcode,
        description: 'Figma for Jira (Forge port)',
      });

      if (response.status === 400) {
        const error = (await response.json().catch(() => ({}))) as { message?: unknown };

        if (error.message === 'Access Denied') {
          throw new PaidPlanRequiredError();
        }
      }

      if (!response.ok) {
        throw new FigmaApiError(response.status, `POST ${path}`);
      }

      const created = (await response.json()) as Record<string, unknown>;

      return { webhookId: String(created.id), teamId: String(created.context_id ?? teamId) };
    },

    async deleteWebhook(accountId: string, webhookId: string): Promise<void> {
      const path = `/v2/webhooks/${encodeURIComponent(webhookId)}`;

      const response = await call(accountId, 'DELETE', path);

      if (!response.ok && response.status !== 404) {
        throw new FigmaApiError(response.status, `DELETE ${path}`);
      }
    },
  };
}

export type FigmaClient = ReturnType<typeof createFigmaClient>;
