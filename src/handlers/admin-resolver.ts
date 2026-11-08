import { randomUUID } from 'node:crypto';

import Resolver from '@forge/resolver';

import type { FigmaAuth } from '../figma/figma-auth';
import { FigmaNotConnectedError } from '../figma/figma-auth';
import type { FigmaClient } from '../figma/figma-client';
import { PaidPlanRequiredError } from '../figma/figma-client';
import type { kvsRegistry } from '../storage/registry';

type Deps = {
  readonly auth: FigmaAuth;
  readonly figma: FigmaClient;
  readonly registry: typeof kvsRegistry;
  readonly redirectUri: () => Promise<string>;
  readonly webhookEndpoint: () => Promise<string>;
};

export type FigmaAuthStatus = { connected: true; email: string } | { connected: false };

export type ConnectTeamResult =
  | { ok: true }
  | { ok: false; reason: 'not-connected' | 'paid-plan-required' | 'invalid-team-id' };

// Ports the admin auth route (/admin/auth/me) and connectFigmaTeamUseCase.
// These run user-invoked from the admin page, so context.accountId is the admin.
export function createAdminResolver({ auth, figma, registry, redirectUri, webhookEndpoint }: Deps) {
  const resolver = new Resolver();

  resolver.define('listTeams', async () => registry.listTeams());

  resolver.define('getFigmaAuth', async ({ context }): Promise<FigmaAuthStatus> => {
    const accountId = context.accountId as string;

    if (!(await auth.isConnected(accountId))) {
      return { connected: false };
    }

    try {
      const me = await figma.getMe(accountId);

      return { connected: true, email: me.email };
    } catch (e) {
      if (e instanceof FigmaNotConnectedError) {
        return { connected: false };
      }

      throw e;
    }
  });

  // Called only on a click, because each call stores a one-time PKCE verifier.
  resolver.define('startFigmaAuth', async ({ context }) => ({
    authorizationUrl: await auth.buildAuthorizationUrl(context.accountId as string, await redirectUri()),
  }));

  resolver.define('connectTeam', async ({ payload, context }): Promise<ConnectTeamResult> => {
    const accountId = context.accountId as string;

    const teamId = String((payload as { teamId?: unknown }).teamId ?? '').trim();

    if (!/^\d{1,30}$/.test(teamId)) {
      return { ok: false, reason: 'invalid-team-id' };
    }

    const passcode = randomUUID();

    try {
      const created = await figma.createTeamWebhook(accountId, { teamId, endpoint: await webhookEndpoint(), passcode });

      // Team names came from the deprecated projects endpoint; the id stands in for now.
      await registry.saveTeam({ webhookId: created.webhookId, passcode, teamId: created.teamId, teamName: `Team ${created.teamId}`, adminAccountId: accountId });

      return { ok: true };
    } catch (e) {
      if (e instanceof FigmaNotConnectedError) {
        return { ok: false, reason: 'not-connected' };
      }

      if (e instanceof PaidPlanRequiredError) {
        return { ok: false, reason: 'paid-plan-required' };
      }

      throw e;
    }
  });

  resolver.define('disconnectFigma', async ({ context }) => {
    await auth.disconnect(context.accountId as string);
  });

  return resolver.getDefinitions();
}
