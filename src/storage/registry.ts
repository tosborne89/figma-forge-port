import { kvs, WhereConditions } from '@forge/kvs';

import { CREDENTIALS_INDEX_PREFIX, CREDENTIALS_PREFIX } from '../figma/figma-auth';

// Replaces the FigmaTeam and FigmaFileWebhook Postgres tables. Forge partitions
// storage per installation, so the connect_installation_id foreign key goes away.
export type FigmaTeamRecord = {
  readonly webhookId: string;
  readonly passcode: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly adminAccountId: string;
};

export type FigmaFileWebhookRecord = {
  readonly webhookId: string;
  readonly passcode: string;
  readonly fileKey: string;
  readonly eventType: 'FILE_UPDATE' | 'DEV_MODE_STATUS_UPDATE';
  readonly creatorAccountId: string;
};

export interface WebhookRegistry {
  findTeamByWebhookId(webhookId: string): Promise<FigmaTeamRecord | undefined>;
  findFileWebhookByWebhookId(webhookId: string): Promise<FigmaFileWebhookRecord | undefined>;
}

const TEAM_PREFIX = 'figma-team:';

const FILE_HOOK_PREFIX = 'figma-file-webhook:';

// Passcodes are secrets, so records are stored with setSecret. The registry
// keeps a non-secret index of team summaries for the admin page.
const TEAM_INDEX_PREFIX = 'figma-team-index:';

export type FigmaTeamSummary = Pick<FigmaTeamRecord, 'teamId' | 'teamName' | 'webhookId'>;

const FILE_HOOK_INDEX_PREFIX = 'figma-file-webhook-index:';

type FileHookSummary = Pick<FigmaFileWebhookRecord, 'webhookId' | 'fileKey' | 'creatorAccountId'>;

async function listByPrefix<T>(prefix: string): Promise<T[]> {
  const items: T[] = [];

  let cursor: string | undefined;

  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);

    if (cursor) {
      query = query.cursor(cursor);
    }

    const page = await query.getMany<T>();

    items.push(...page.results.map((r) => r.value));

    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

export const kvsRegistry: WebhookRegistry & {
  saveTeam(team: FigmaTeamRecord): Promise<void>;
  saveFileWebhook(hook: FigmaFileWebhookRecord): Promise<void>;
  listTeams(): Promise<FigmaTeamSummary[]>;
  listAllWebhooks(): Promise<{ webhookId: string; ownerAccountId: string }[]>;
  deleteAll(): Promise<void>;
} = {
  async findTeamByWebhookId(webhookId) {
    return (await kvs.getSecret(TEAM_PREFIX + webhookId)) as FigmaTeamRecord | undefined;
  },

  async findFileWebhookByWebhookId(webhookId) {
    return (await kvs.getSecret(FILE_HOOK_PREFIX + webhookId)) as FigmaFileWebhookRecord | undefined;
  },

  async saveTeam(team) {
    await kvs.setSecret(TEAM_PREFIX + team.webhookId, team);

    const summary: FigmaTeamSummary = { teamId: team.teamId, teamName: team.teamName, webhookId: team.webhookId };

    await kvs.set(TEAM_INDEX_PREFIX + team.webhookId, summary);
  },

  async saveFileWebhook(hook) {
    await kvs.setSecret(FILE_HOOK_PREFIX + hook.webhookId, hook);

    const summary: FileHookSummary = { webhookId: hook.webhookId, fileKey: hook.fileKey, creatorAccountId: hook.creatorAccountId };

    await kvs.set(FILE_HOOK_INDEX_PREFIX + hook.webhookId, summary);
  },

  async listTeams() {
    return listByPrefix<FigmaTeamSummary>(TEAM_INDEX_PREFIX);
  },

  // The team index has no admin account id, so team owners are read from the secret record.
  async listAllWebhooks() {
    const teams = await this.listTeams();

    const teamHooks = await Promise.all(teams.map(async (t) => {
      const full = await this.findTeamByWebhookId(t.webhookId);

      return { webhookId: t.webhookId, ownerAccountId: full?.adminAccountId ?? '' };
    }));

    const fileHooks = (await listByPrefix<FileHookSummary>(FILE_HOOK_INDEX_PREFIX))
      .map((h) => ({ webhookId: h.webhookId, ownerAccountId: h.creatorAccountId }));

    return [...teamHooks, ...fileHooks];
  },

  async deleteAll() {
    for (const team of await this.listTeams()) {
      await kvs.deleteSecret(TEAM_PREFIX + team.webhookId);

      await kvs.delete(TEAM_INDEX_PREFIX + team.webhookId);
    }

    for (const hook of await listByPrefix<FileHookSummary>(FILE_HOOK_INDEX_PREFIX)) {
      await kvs.deleteSecret(FILE_HOOK_PREFIX + hook.webhookId);

      await kvs.delete(FILE_HOOK_INDEX_PREFIX + hook.webhookId);
    }

    // Figma tokens go last: preUninstall needs them to delete the webhooks first.
    for (const { accountId } of await listByPrefix<{ accountId: string }>(CREDENTIALS_INDEX_PREFIX)) {
      await kvs.deleteSecret(CREDENTIALS_PREFIX + accountId);

      await kvs.delete(CREDENTIALS_INDEX_PREFIX + accountId);
    }
  },
};
