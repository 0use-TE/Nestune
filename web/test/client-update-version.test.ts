import { expect, it } from 'vitest';
import { newerVersion } from '@/components/ClientUpdates';
it('compares client versions numerically and does not propose downgrades or malformed releases', () => {
  expect(newerVersion('1.2.10', '1.2.9')).toBe(true);
  expect(newerVersion('1.3.0', '1.2.99')).toBe(true);
  expect(newerVersion('1.2.4', '1.2.4')).toBe(false);
  expect(newerVersion('1.2.3', '1.2.4')).toBe(false);
  expect(newerVersion('invalid', '1.2.4')).toBe(false);
});
