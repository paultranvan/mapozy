import { createMockDb } from '../mockDb';
import { runMigrations } from '../migrations';
import {
  createCustomCategory, getCustomCategories, updateCustomCategory, deleteCustomCategory,
} from '../customCategories';

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

  it('updates name, icon and color in place', async () => {
    const db = createMockDb();
    await runMigrations(db);
    const id = await createCustomCategory(db, { name: 'Gym', icon: 'dumbbell', color: '#21B930' });
    const other = await createCustomCategory(db, { name: 'Piscine', icon: 'swim', color: '#1CAAE8' });
    await updateCustomCategory(db, id, { name: 'Escalade', icon: 'hiking', color: '#EA3F3F' });
    const cats = await getCustomCategories(db);
    expect(cats).toEqual([
      { id, name: 'Escalade', icon: 'hiking', color: '#EA3F3F' },
      { id: other, name: 'Piscine', icon: 'swim', color: '#1CAAE8' },
    ]);
  });
});
