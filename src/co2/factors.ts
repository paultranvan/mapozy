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
  tram: 0.0046,
  subway: 0.0036,
  metro: 0.0036,
  unknown: 0.218,
};

// Aviation is distance-dependent (short hops carry the fixed climb/descent cost
// over fewer km) and, unlike ground modes, has a large non-CO₂ warming effect
// (contrails, NOx, high-altitude water vapour). We pick a base ADEME-2024-style
// economy factor by great-circle distance and multiply by a radiative-forcing
// factor, so the result is a CO₂-equivalent (CO₂e) climate-impact estimate.
// All values are tunable.
export const PLANE_CO2 = {
  radiativeForcing: 1.9,
  // Picked by the lowest tier whose maxKm the flight is under.
  tiers: [
    { maxKm: 1000, baseKgPerKm: 0.23 }, // short-haul
    { maxKm: 3500, baseKgPerKm: 0.178 }, // medium-haul
    { maxKm: Infinity, baseKgPerKm: 0.152 }, // long-haul
  ],
};
