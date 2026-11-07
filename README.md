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

## What is not ported, and why

- **The Designs panel (`jiraDesignInfoProvider`).** Forge has no equivalent module and no design scope. See the audit.
- **Figma OAuth.** Forge's built-in external auth only works in user-invoked functions, and the sync and uninstall paths run with no user. `src/figma/figma-client.ts` marks the boundary with `FigmaOAuthNotPortedError`.

## Run

```bash
npm install
npm test          # 17 unit tests, no Forge runtime needed
npm run typecheck
forge login       # needs an Atlassian account and API token
forge register    # replaces the placeholder app id in manifest.yml
forge lint && forge deploy && forge install
```

The Forge CLI supports Node 22 or 24.
