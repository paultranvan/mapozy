// ADEME 2024 baseline factors for France (kg CO2eq / km).
// Values mirror coachCO2/openpath, see spec §9.

export const CO2_FACTORS_KG_PER_KM: Record<string, number> = {
  car: 0.218,
  car_electric: 0.103,
  bike: 0,
  walk: 0,
  run: 0,
  bus: 0.103,
  train: 0.0241,
  metro: 0.0036,
  unknown: 0.218,
};
