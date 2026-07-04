import { boatGuard, classifyBoat } from '../classifySection';
import type { WaterWay } from '../../../lib/overpass';

// Straight canal running north at lon 3.20, lat 51.20 → 51.25 (~5.5 km).
const canal: WaterWay = {
  id: 1,
  water: 'canal',
  coords: Array.from({ length: 12 }, (_, i) => [3.2, 51.2 + i * 0.005] as [number, number]),
};

// Trace ON the canal (same line, slight jitter well under the 35 m buffer).
function canalTrace(): Array<[number, number]> {
  return Array.from(
    { length: 30 },
    (_, i) => [3.2 + (i % 2 === 0 ? 0.00005 : -0.00005), 51.2 + i * 0.0015] as [number, number]
  );
}

// Trace parallel to the canal but ~150 m east — a road along the water.
function quaiTrace(): Array<[number, number]> {
  return Array.from({ length: 30 }, (_, i) => [3.2021, 51.2 + i * 0.0015] as [number, number]);
}

describe('boatGuard', () => {
  it('accepts a slow, long section (canal cruise ~15 km/h)', () => {
    expect(boatGuard(5000, 1200)).toBe(true); // 4.2 m/s
  });
  it('rejects fast sections (riverside driving)', () => {
    expect(boatGuard(5000, 400)).toBe(false); // 12.5 m/s
  });
  it('rejects short hops', () => {
    expect(boatGuard(500, 300)).toBe(false);
  });
});

describe('classifyBoat', () => {
  it('classifies a trace hugging the canal as boat', () => {
    const cls = classifyBoat(canalTrace(), [canal]);
    expect(cls?.mode).toBe('boat');
    expect(cls?.modeSource).toBe('watermatch');
    expect(cls!.modeConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('rejects a parallel quai-side trace outside the buffer', () => {
    expect(classifyBoat(quaiTrace(), [canal])).toBeNull();
  });

  it('returns null with no waterways around', () => {
    expect(classifyBoat(canalTrace(), [])).toBeNull();
  });
});
