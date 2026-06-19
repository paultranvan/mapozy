import type { Db } from './client';

export interface CustomCategory {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export interface CustomCategoryInput {
  name: string;
  icon: string;
  color: string;
}

export async function createCustomCategory(db: Db, input: CustomCategoryInput): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO custom_categories (name, icon, color, created_at_ms) VALUES (?, ?, ?, ?)`,
    input.name, input.icon, input.color, Date.now()
  );
  return res.lastInsertRowId;
}

export async function getCustomCategories(db: Db): Promise<CustomCategory[]> {
  return db.getAllAsync<CustomCategory>(
    `SELECT id, name, icon, color FROM custom_categories ORDER BY created_at_ms`
  );
}

export async function deleteCustomCategory(db: Db, id: number): Promise<void> {
  await db.runAsync(`DELETE FROM custom_categories WHERE id = ?`, id);
}
