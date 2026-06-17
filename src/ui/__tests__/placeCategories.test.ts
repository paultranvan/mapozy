import { PLACE_CATEGORIES, categoryMeta } from '../placeCategories';
import { PLACE_CATEGORY_VALUES } from '../../types';

it('has 9 distinct categories with color + icon', () => {
  expect(PLACE_CATEGORIES).toHaveLength(9);
  for (const c of PLACE_CATEGORIES) {
    expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(c.icon.length).toBeGreaterThan(0);
  }
});

it('maps home to its coachCO2-style color and falls back to other', () => {
  expect(categoryMeta('work').color).toBe('#8978FF');
  expect(categoryMeta(null).key).toBe('other');
  expect(categoryMeta('home').labelFr).toBe('Maison');
});

it('covers every PlaceCategory', () => {
  const keys = new Set(PLACE_CATEGORIES.map((c) => c.key));
  for (const v of PLACE_CATEGORY_VALUES) expect(keys.has(v)).toBe(true);
  expect(keys.size).toBe(PLACE_CATEGORY_VALUES.length);
});
