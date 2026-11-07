import React, { useEffect, useState } from 'react';
import ForgeReconciler, { DynamicTable, Heading, SectionMessage, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

type TeamSummary = { teamId: string; teamName: string; webhookId: string };

// Replaces the Connect admin page (React and Atlaskit served from the app's own
// server under admin_plugins_menu). UI Kit renders natively in Jira, so the AP.*
// bridge, the iframe and the static hosting all go away.
const App = () => {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);

  useEffect(() => {
    // No metadata was requested, so the response is the plain body.
    invoke<TeamSummary[]>('listTeams').then((res) => setTeams(res as TeamSummary[]));
  }, []);

  const rows = (teams ?? []).map((t) => ({
    key: t.webhookId,
    cells: [{ key: 'name', content: t.teamName }, { key: 'id', content: t.teamId }],
  }));

  return (
    <Stack space="space.200">
      <Heading as="h2">Connected Figma teams</Heading>

      <SectionMessage appearance="information">
        <Text>Case-study port. Connecting new teams needs the Figma OAuth port, which is not done yet.</Text>
      </SectionMessage>

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
