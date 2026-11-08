# Figma for Jira: Forge port (case study)

A partial port of [atlassian-labs/figma-for-jira](https://github.com/atlassian-labs/figma-for-jira) (Apache-2.0), a Connect app, to Atlassian Forge. It is a migration case study, not a product, and has no connection to Figma or Atlassian.

## What is ported

| Connect (original) | Forge (here) |
|---|---|
| Admin page under `admin_plugins_menu`, served from the app's own server | `jira:adminPage` in UI Kit (`src/frontend`) with a resolver |
| `installed` lifecycle webhook storing `clientKey` and `sharedSecret` | `avi:forge:installed:app` trigger; nothing to store |
| `uninstalled` lifecycle webhook | `preUninstall` (55 s): best-effort Figma webhook deletion, then local cleanup |
| `POST /figma/webhook` and `/figma/webhook/file`, with passcode check | One web trigger, routed by `userPath`; constant-time passcode check |
| Background sync via `setImmediate`, no retry | Forge Async Events queue and consumer (up to 900 s); a queue failure returns 500 so Figma retries |
| Postgres tables `FigmaTeam` and `FigmaFileWebhook` | Forge KVS, with passcodes in secret storage |
| Postgres table `ConnectInstallation` and the Connect JWT middleware | Removed: Forge owns installation identity and request auth |
| Figma OAuth 2.0 with a signed state, tokens in Postgres | The app's own OAuth, kept on purpose (see below): HMAC-signed state plus one-time PKCE S256, a callback web trigger, tokens in Forge secret storage, refresh through Forge `fetch` |

## What is not ported, and why

- **The Designs panel (`jiraDesignInfoProvider`).** Forge has no equivalent module and no design scope. See the audit.
- **Team names.** They came from Figma's deprecated `projects:read` endpoint; the team ID stands in.

## Why not Forge external auth (`withProvider`)?

It only works in functions a user invokes from the UI ([developer community](https://community.developer.atlassian.com/t/can-forge-webtriggers-access-provider-authentication-like-google/96357)). This app calls Figma from the queue consumer and from `preUninstall`, where no user is present, so it keeps its own OAuth code and stores tokens per Atlassian account.

Forge web trigger URLs differ per site, so a Marketplace app cannot register one OAuth redirect URI with Figma. It needs a small relay or one OAuth app per customer. This port registers the single site's callback URL.

## Dev-only test

Figma only allows webhooks on paid plans. The admin page has a "Test background sync (dev only)" box that queues the same job a webhook would, so the no-user consumer path can be shown on a free plan. Remove it before production use.

## Run

```bash
npm install
npm test          # 60 unit tests, no Forge runtime needed
npm run typecheck
forge login       # needs an Atlassian account and API token
forge register    # replaces the placeholder app id in manifest.yml
forge variables set --encrypt FIGMA_CLIENT_ID <id>          # from a Figma OAuth app
forge variables set --encrypt FIGMA_CLIENT_SECRET <secret>
forge variables set --encrypt FIGMA_STATE_KEY "$(openssl rand -base64 48)"
forge lint && forge deploy && forge install
forge webtrigger create -f figma-oauth-callback   # register this URL as the redirect URL in the Figma app
```

Figma OAuth app scopes: `current_user:read`, `file_content:read`, `file_metadata:read`, `webhooks:read`, `webhooks:write`.

The Forge CLI supports Node 22 or 24.
