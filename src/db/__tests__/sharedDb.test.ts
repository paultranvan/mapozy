import { getSharedDb, _resetSharedDbForTests } from '../sharedDb';
import type { Db } from '../client';

beforeEach(() => _resetSharedDbForTests());

describe('getSharedDb', () => {
  it('opens once and hands every caller the SAME instance', async () => {
    // Pipeline runs are serialized per Db INSTANCE (WeakMap chain in
    // runPipeline) — the app UI and the native-triggered headless task must
    // share one instance or concurrent runs race into duplicate trips.
    let opens = 0;
    const fake = {} as Db;
    const opener = async () => {
      opens++;
      return fake;
    };
    const [a, b] = await Promise.all([getSharedDb(opener), getSharedDb(opener)]);
    const c = await getSharedDb(opener);
    expect(opens).toBe(1);
    expect(a).toBe(fake);
    expect(b).toBe(fake);
    expect(c).toBe(fake);
  });

  it('does not wedge forever after a failed open', async () => {
    let calls = 0;
    const opener = async () => {
      calls++;
      if (calls === 1) throw new Error('disk full');
      return {} as Db;
    };
    await expect(getSharedDb(opener)).rejects.toThrow('disk full');
    await expect(getSharedDb(opener)).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });
});
