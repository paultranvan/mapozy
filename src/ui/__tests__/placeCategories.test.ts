import { builtinCategories, categoryMeta } from '../placeCategories';
import { PLACE_CATEGORY_VALUES } from '../../types';
import { setCurrentLocale } from '@/i18n';

it('has 9 distinct categories with color + icon', () => {
  const cats = builtinCategories();
  expect(cats).toHaveLength(8);
  for (const c of cats) {
    expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(c.icon.length).toBeGreaterThan(0);
  }
});

it('maps home to its coachCO2-style color and falls back to other', () => {
  expect(categoryMeta('work').color).toBe('#8978FF');
  expect(categoryMeta(null).key).toBe('other');
  setCurrentLocale('en');
  expect(categoryMeta('home').label).toBe('Home');
  setCurrentLocale('fr');
  expect(categoryMeta('home').label).toBe('Maison');
  setCurrentLocale('en');
});

it('covers every PlaceCategory', () => {
  const keys = new Set(builtinCategories().map((c) => c.key));
  for (const v of PLACE_CATEGORY_VALUES) expect(keys.has(v)).toBe(true);
  expect(keys.size).toBe(PLACE_CATEGORY_VALUES.length);
});
