import { CO2_FACTORS_KG_PER_KM } from './factors';

export function co2GramsForSection(mode: string, distanceM: number): number {
  const factor =
    CO2_FACTORS_KG_PER_KM[mode] ?? CO2_FACTORS_KG_PER_KM['unknown']!;
  return (distanceM / 1000) * factor * 1000;
}
