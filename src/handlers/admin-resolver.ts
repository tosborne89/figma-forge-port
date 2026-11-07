import Resolver from '@forge/resolver';

import { kvsRegistry } from '../storage/registry';

// Ports listFigmaTeamsUseCase, the read side of the Connect admin page.
// Connecting a team needs the Figma OAuth port, so there is no "connect" call yet.
const resolver = new Resolver();

resolver.define('listTeams', async () => kvsRegistry.listTeams());

export const adminResolver = resolver.getDefinitions();
