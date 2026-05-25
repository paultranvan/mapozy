import { buildExportFilename } from '../sendDbToPaul';

describe('buildExportFilename', () => {
  it('uses YYYY-MM-DD from the given date', () => {
    const d = new Date('2026-05-25T14:23:11.000Z');
    expect(buildExportFilename(d)).toBe('mapozy-export-2026-05-25.db');
  });

  it('pads single-digit months and days', () => {
    const d = new Date('2026-01-03T00:00:00.000Z');
    expect(buildExportFilename(d)).toBe('mapozy-export-2026-01-03.db');
  });
});
