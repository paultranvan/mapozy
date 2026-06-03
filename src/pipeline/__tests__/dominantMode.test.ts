import { dominantModeFor } from '../dominantMode';

describe('dominantModeFor', () => {
  it('picks the mode with the largest distance share', () => {
    expect(
      dominantModeFor([
        { mode: 'train', distanceM: 9000 },
        { mode: 'walk', distanceM: 500 },
      ])
    ).toBe('train');
  });

  it("labels 'mixed' when the top share is below the threshold (0.7)", () => {
    expect(
      dominantModeFor([
        { mode: 'car', distanceM: 600 },
        { mode: 'bike', distanceM: 500 },
      ])
    ).toBe('mixed');
  });

  it('handles a single mode trivially', () => {
    expect(dominantModeFor([{ mode: 'subway', distanceM: 3000 }])).toBe('subway');
  });
});
