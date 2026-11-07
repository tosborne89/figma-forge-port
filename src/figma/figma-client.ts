// Boundary for every Figma API call. Not ported yet, on purpose.
//
// Forge's built-in external auth (withProvider) only works when a user invokes the
// function from the UI. Both callers here, the queue consumer and preUninstall, run
// with no user present. The Connect app's own OAuth code (tokens in Forge secret
// storage, refresh via plain fetch to declared egress) has to be ported first.
// See the "Checked 2026-11-07" section of the audit.
export class FigmaOAuthNotPortedError extends Error {
  constructor(operation: string) {
    super(`${operation} needs the Figma OAuth port (not done yet)`);
  }
}

export const figmaClient = {
  async deleteWebhook(webhookId: string, _ownerAccountId: string): Promise<void> {
    throw new FigmaOAuthNotPortedError(`DELETE /v2/webhooks/${webhookId}`);
  },

  async syncFile(fileKey: string): Promise<void> {
    throw new FigmaOAuthNotPortedError(`GET /v1/files/${fileKey}`);
  },
};
