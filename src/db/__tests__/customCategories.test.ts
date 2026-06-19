import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import { createCustomCategory, getCustomCategories, deleteCustomCategory } from '../customCategories';

describe('custom categories', () => {
  it('creates, lists and deletes', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await createCustomCategory(db, { name: 'Gym', icon: 'dumbbell', color: '#21B930' });
    let cats = await getCustomCategories(db);
    expect(cats).toEqual([{ id, name: 'Gym', icon: 'dumbbell', color: '#21B930' }]);
    await deleteCustomCategory(db, id);
    expect(await getCustomCategories(db)).toHaveLength(0);
  });
});
