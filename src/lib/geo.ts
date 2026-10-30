// The dataset's 15 cities: state and approximate position (longitude, latitude).
export const CITIES: Record<string, { state: string; lon: number; lat: number }> = {
  Delhi: { state: "Delhi", lon: 77.21, lat: 28.61 },
  Jaipur: { state: "Rajasthan", lon: 75.79, lat: 26.91 },
  Lucknow: { state: "Uttar Pradesh", lon: 80.95, lat: 26.85 },
  Ahmedabad: { state: "Gujarat", lon: 72.57, lat: 23.02 },
  Indore: { state: "Madhya Pradesh", lon: 75.86, lat: 22.72 },
  Kolkata: { state: "West Bengal", lon: 88.36, lat: 22.57 },
  Nagpur: { state: "Maharashtra", lon: 79.09, lat: 21.15 },
  Mumbai: { state: "Maharashtra", lon: 72.88, lat: 19.08 },
  Pune: { state: "Maharashtra", lon: 73.86, lat: 18.52 },
  Visakhapatnam: { state: "Andhra Pradesh", lon: 83.22, lat: 17.69 },
  Hyderabad: { state: "Telangana", lon: 78.49, lat: 17.39 },
  Chennai: { state: "Tamil Nadu", lon: 80.27, lat: 13.08 },
  Bengaluru: { state: "Karnataka", lon: 77.59, lat: 12.97 },
  Coimbatore: { state: "Tamil Nadu", lon: 76.96, lat: 11.02 },
  Kochi: { state: "Kerala", lon: 76.27, lat: 9.93 },
};

export const stateOf = (city: string) => CITIES[city]?.state ?? "—";
