import type { Weather, WeatherLocation } from "./types";

/** Open-Meteo: free, no API key. https://open-meteo.com */
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

export async function fetchWeather(loc: WeatherLocation, fahrenheit: boolean): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: loc.latitude.toFixed(3),
    longitude: loc.longitude.toFixed(3),
    current: "temperature_2m,apparent_temperature,weather_code,is_day",
    hourly: "temperature_2m,weather_code,is_day",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "2",
    timezone: "auto",
    temperature_unit: fahrenheit ? "fahrenheit" : "celsius",
  });
  const res = await fetch(`${FORECAST}?${q}`);
  if (!res.ok) throw new Error(`Weather unavailable (${res.status})`);
  return parseForecast(await res.json(), Date.now());
}

export async function geocode(query: string): Promise<WeatherLocation[]> {
  const q = new URLSearchParams({ name: query.trim(), count: "5", language: "en", format: "json" });
  const res = await fetch(`${GEOCODE}?${q}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
  return (data.results ?? []).map((r) => ({
    name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(", "),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

interface Forecast {
  current: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; is_day: number[] };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[] };
}

/** Pure: turns the API response into what the island shows. */
export function parseForecast(raw: unknown, now: number): Weather {
  const f = raw as Forecast;
  // Hourly times are local ("2026-11-05T14:00"), like `current.time`.
  const start = Math.max(0, f.hourly.time.findIndex((t) => t > f.current.time));
  const hourly = f.hourly.time.slice(start, start + 6).map((time, i) => ({
    time,
    temp: f.hourly.temperature_2m[start + i]!,
    code: f.hourly.weather_code[start + i]!,
    isDay: f.hourly.is_day[start + i] === 1,
  }));
  return {
    fetchedAt: now,
    temp: f.current.temperature_2m,
    feelsLike: f.current.apparent_temperature,
    code: f.current.weather_code,
    isDay: f.current.is_day === 1,
    high: f.daily.temperature_2m_max[0]!,
    low: f.daily.temperature_2m_min[0]!,
    precipChance: f.daily.precipitation_probability_max?.[0] ?? null,
    hourly,
  };
}

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** WMO weather interpretation codes → our icon set + label. */
export function describe(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: "clear", label: "Clear" };
  if (code === 1) return { kind: "partly", label: "Mostly clear" };
  if (code === 2) return { kind: "partly", label: "Partly cloudy" };
  if (code === 3) return { kind: "cloudy", label: "Cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", label: "Fog" };
  if (code >= 51 && code <= 57) return { kind: "drizzle", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: "rain", label: code >= 80 ? "Showers" : "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: "snow", label: "Snow" };
  if (code >= 95) return { kind: "storm", label: "Thunderstorm" };
  return { kind: "cloudy", label: "—" };
}

/** Weather is refreshed at most this often. */
export const WEATHER_TTL_MS = 15 * 60_000;
