import { describe, expect, it } from 'vitest';

import { createState, verifyState } from '../src/figma/oauth-state';

const KEY = 'test-state-key-0123456789abcdef';

const NOW = 1_800_000_000_000;

describe('OAuth state', () => {
  it('round-trips the account id and nonce', () => {
    const state = createState({ accountId: 'acc-1', nonce: 'n1' }, KEY, NOW);

    expect(verifyState(state, KEY, NOW + 1000)).toEqual({ accountId: 'acc-1', nonce: 'n1' });
  });

  it('rejects a state signed with another key', () => {
    const state = createState({ accountId: 'acc-1', nonce: 'n1' }, 'another-key-0123456789abcdef', NOW);

    expect(verifyState(state, KEY, NOW)).toBeUndefined();
  });

  it('rejects a state whose payload was changed', () => {
    const state = createState({ accountId: 'acc-1', nonce: 'n1' }, KEY, NOW);

    const [, sig] = state.split('.');

    const forged = Buffer.from(JSON.stringify({ accountId: 'attacker', nonce: 'n1', exp: NOW + 60_000 })).toString('base64url');

    expect(verifyState(`${forged}.${sig}`, KEY, NOW)).toBeUndefined();
  });

  it('rejects a state older than five minutes', () => {
    const state = createState({ accountId: 'acc-1', nonce: 'n1' }, KEY, NOW);

    expect(verifyState(state, KEY, NOW + 5 * 60_000 + 1)).toBeUndefined();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'not-base64.!!!'])('rejects malformed state %j', (state) => {
    expect(verifyState(state, KEY, NOW)).toBeUndefined();
  });
});
