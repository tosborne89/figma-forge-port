import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  ButtonGroup,
  DynamicTable,
  Heading,
  Inline,
  SectionMessage,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';

type TeamSummary = { teamId: string; teamName: string; webhookId: string };

type FigmaAuthStatus = { connected: true; email: string } | { connected: false };

type ConnectTeamResult = { ok: true } | { ok: false; reason: 'not-connected' | 'paid-plan-required' | 'invalid-team-id' };

const CONNECT_ERRORS: Record<string, string> = {
  'not-connected': 'Connect your Figma account first.',
  'paid-plan-required': 'Figma only allows webhooks on paid plans, so this team cannot be connected.',
  'invalid-team-id': 'A Figma team ID is the number after /team/ in the team URL.',
};

// Replaces the Connect admin page (React and Atlaskit served from the app's own
// server under admin_plugins_menu). UI Kit renders natively in Jira, so the AP.*
// bridge, the iframe and the static hosting all go away.
const App = () => {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);

  const [figmaAuth, setFigmaAuth] = useState<FigmaAuthStatus | null>(null);

  const [teamId, setTeamId] = useState('');

  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    // No metadata was requested, so each response is the plain body.
    invoke<TeamSummary[]>('listTeams').then((res) => setTeams(res as TeamSummary[]));

    invoke<FigmaAuthStatus>('getFigmaAuth').then((res) => setFigmaAuth(res as FigmaAuthStatus));
  }, []);

  useEffect(refresh, [refresh]);

  // Figma does not allow its sign-in inside a WebView, so it opens in a new browser tab.
  const signIn = async () => {
    const { authorizationUrl } = (await invoke('startFigmaAuth')) as { authorizationUrl: string };

    await router.open(authorizationUrl);

    setMessage('Finish signing in to Figma in the new tab, then press Refresh.');
  };

  const signOut = async () => {
    await invoke('disconnectFigma');

    refresh();
  };

  const connectTeam = async () => {
    const result = (await invoke('connectTeam', { teamId })) as ConnectTeamResult;

    setMessage(result.ok ? 'Team connected.' : CONNECT_ERRORS[result.reason] ?? 'Could not connect the team.');

    refresh();
  };

  const rows = (teams ?? []).map((t) => ({
    key: t.webhookId,
    cells: [{ key: 'name', content: t.teamName }, { key: 'id', content: t.teamId }],
  }));

  return (
    <Stack space="space.200">
      <Heading as="h2">Figma account</Heading>

      {figmaAuth === null && <Text>Checking Figma connection...</Text>}

      {figmaAuth?.connected === true && (
        <Inline space="space.100" alignBlock="center">
          <Text>Connected as {figmaAuth.email}</Text>

          <Button onClick={signOut}>Disconnect</Button>
        </Inline>
      )}

      {figmaAuth?.connected === false && (
        <ButtonGroup>
          <Button appearance="primary" onClick={signIn}>Connect Figma</Button>

          <Button onClick={refresh}>Refresh</Button>
        </ButtonGroup>
      )}

      {message && (
        <SectionMessage appearance="information">
          <Text>{message}</Text>
        </SectionMessage>
      )}

      <Heading as="h2">Connected Figma teams</Heading>

      <Inline space="space.100" alignBlock="end">
        <Textfield name="teamId" placeholder="Figma team ID" value={teamId} onChange={(e) => setTeamId(e.target.value)} />

        <Button onClick={connectTeam} isDisabled={figmaAuth?.connected !== true}>Connect team</Button>
      </Inline>

      <DynamicTable
        isLoading={teams === null}
        head={{ cells: [{ key: 'name', content: 'Team' }, { key: 'id', content: 'Team ID' }] }}
        rows={rows}
        emptyView={<Text>No Figma teams connected.</Text>}
      />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
