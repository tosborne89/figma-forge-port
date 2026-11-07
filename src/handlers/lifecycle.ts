export type StoredWebhook = {
  readonly webhookId: string;
  readonly ownerAccountId: string;
};

type PreUninstallDeps = {
  readonly listWebhooks: () => Promise<StoredWebhook[]>;
  readonly deleteFigmaWebhook: (hook: StoredWebhook) => Promise<void>;
  readonly deleteLocalData: () => Promise<void>;
};

// Ports uninstalledUseCase. Forge owns installation identity, so there is no
// ConnectInstallation row or app-configuration property to remove. preUninstall
// has a 55-second timeout, which bounds how many webhooks can be deleted here.
export function createPreUninstallHandler({ listWebhooks, deleteFigmaWebhook, deleteLocalData }: PreUninstallDeps) {
  return async (): Promise<void> => {
    const hooks = await listWebhooks();

    const results = await Promise.allSettled(hooks.map((hook) => deleteFigmaWebhook(hook)));

    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      console.warn(`preUninstall: ${failed} of ${hooks.length} Figma webhooks could not be deleted`);
    }

    await deleteLocalData();
  };
}

// Ports installedUseCase, which only stored clientKey and sharedSecret.
// Forge holds both, so nothing needs storing.
export async function onInstalledHandler(event: { readonly installerAccountId?: string }): Promise<void> {
  console.info('Installed', { installer: event.installerAccountId ?? 'unknown' });
}
