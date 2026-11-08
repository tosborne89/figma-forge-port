import { describe, expect, it } from 'vitest';

import { parseFigmaFileKey } from '../src/domain/sync-job';

describe('parseFigmaFileKey', () => {
  it.each([
    ['https://www.figma.com/design/AbC123xyz789/Checkout?node-id=0-1', 'AbC123xyz789'],
    ['https://www.figma.com/file/AbC123xyz789/Checkout', 'AbC123xyz789'],
    ['figma.com/design/AbC123xyz789', 'AbC123xyz789'],
    ['  AbC123xyz789  ', 'AbC123xyz789'],
  ])('reads the key from %j', (input, key) => {
    expect(parseFigmaFileKey(input)).toBe(key);
  });

  it.each(['', 'https://example.com/design/AbC123xyz789', '../../etc', 'short'])('rejects %j', (input) => {
    expect(parseFigmaFileKey(input)).toBeUndefined();
  });
});
