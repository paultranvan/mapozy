import { CO2_FACTORS_KG_PER_KM, PLANE_CO2 } from './factors';

export function co2GramsForSection(mode: string, distanceM: number): number {
  if (mode === 'plane') return planeCo2Grams(distanceM);
  const factor =
    CO2_FACTORS_KG_PER_KM[mode] ?? CO2_FACTORS_KG_PER_KM['unknown']!;
  return (distanceM / 1000) * factor * 1000;
}

// Distance-tiered base factor × radiative forcing → CO₂e grams.
function planeCo2Grams(distanceM: number): number {
  const km = distanceM / 1000;
  const tier =
    PLANE_CO2.tiers.find((t) => km < t.maxKm) ??
    PLANE_CO2.tiers[PLANE_CO2.tiers.length - 1]!;
  const factor = tier.baseKgPerKm * PLANE_CO2.radiativeForcing;
  return km * factor * 1000;
}
