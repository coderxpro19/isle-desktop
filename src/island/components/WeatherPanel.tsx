import { useEffect, useRef, useState } from "react";
import type { WeatherLocation } from "@/lib/types";
import { describe } from "@/lib/weather";
import { useIsland } from "../store";
import { PinIcon, SearchIcon, WeatherGlyph } from "./icons";

const deg = (v: number) => `${Math.round(v)}°`;

export function WeatherPanel() {
  const loc = useIsland((s) => s.settings.weather.location);
  const [editing, setEditing] = useState(false);
  if (!loc || editing) return <LocationPicker onDone={() => setEditing(false)} canCancel={!!loc} />;
  return <Forecast name={loc.name} onChangeLocation={() => setEditing(true)} />;
}

function Forecast({ name, onChangeLocation }: { name: string; onChangeLocation(): void }) {
  const w = useIsland((s) => s.weather);
  const err = useIsland((s) => s.weatherError);
  const fahrenheit = useIsland((s) => s.settings.weather.fahrenheit);
  const updateSettings = useIsland((s) => s.updateSettings);

  if (!w) {
    return <div className="grid h-full place-items-center text-[12px] text-white/45">{err ?? "Loading weather…"}</div>;
  }
  const d = describe(w.code);
  return (
    <div className="flex h-full flex-col justify-between px-5 pt-1 pb-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <WeatherGlyph kind={d.kind} day={w.isDay} size={50} />
          <div>
            <div className="text-[40px] leading-none font-semibold tracking-tight text-white">{deg(w.temp)}</div>
            <div className="mt-1 text-[12px] text-white/55">Feels like {deg(w.feelsLike)}</div>
          </div>
        </div>
        <div className="text-right leading-snug">
          <div className="text-[13px] font-semibold text-white">{d.label}</div>
          <div className="text-[12px] text-white/55">
            H {deg(w.high)} · L {deg(w.low)}
          </div>
          {w.precipChance !== null && <div className="text-[12px] text-[#5ab8ff]">{w.precipChance}% rain</div>}
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1">
        {w.hourly.map((h) => (
          <div key={h.time} className="flex flex-col items-center gap-1 rounded-xl py-1.5">
            <span className="text-[10.5px] font-medium text-white/45">{formatHour(h.time)}</span>
            <WeatherGlyph kind={describe(h.code).kind} day={h.isDay} size={20} />
            <span className="text-[12px] font-semibold text-white/90 tabular-nums">{deg(h.temp)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] text-white/40">
        <button type="button" onClick={(e) => (e.stopPropagation(), onChangeLocation())} className="flex items-center gap-1 rounded-md hover:text-white">
          <PinIcon size={12} />
          <span className="max-w-[230px] truncate">{name}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateSettings((s) => ({ ...s, weather: { ...s.weather, fahrenheit: !s.weather.fahrenheit } }));
          }}
          className="rounded-md px-1 hover:text-white"
          aria-label="Switch temperature unit"
        >
          {fahrenheit ? "°F" : "°C"}
        </button>
      </div>
    </div>
  );
}

function formatHour(iso: string): string {
  const h = Number(iso.slice(11, 13));
  const { clock24h } = useIsland.getState().settings.island;
  if (clock24h) return `${String(h).padStart(2, "0")}:00`;
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

function LocationPicker({ onDone, canCancel }: { onDone(): void; canCancel: boolean }) {
  const backend = useIsland((s) => s.backend);
  const updateSettings = useIsland((s) => s.updateSettings);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherLocation[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const unpin = useRef<(() => void) | null>(null);

  // Keep the island open while the user types.
  useEffect(() => () => unpin.current?.(), []);

  const choose = (loc: WeatherLocation) => {
    useIsland.setState({ weather: null, weatherError: null });
    updateSettings((s) => ({ ...s, weather: { ...s.weather, location: loc } }));
    onDone();
  };

  useEffect(() => {
    if (!backend || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      backend
        .geocode(query)
        .then((r) => {
          setResults(r);
          setStatus(r.length ? null : "No matches");
        })
        .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [backend, query]);

  return (
    <div className="flex h-full flex-col gap-2.5 px-5 pt-1 pb-4" onClick={(e) => e.stopPropagation()}>
      <div className="text-[13px] font-semibold text-white">Where are you?</div>
      <div className="flex gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-xl bg-white/10 px-3 text-white/50 focus-within:bg-white/15">
          <SearchIcon size={14} />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => (unpin.current ??= useIsland.getState().pin())}
            onBlur={() => {
              unpin.current?.();
              unpin.current = null;
            }}
            onKeyDown={(e) => e.key === "Enter" && results[0] && choose(results[0])}
            placeholder="Search a city"
            className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
          />
        </label>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#2f7bff] px-3 text-[12px] font-semibold text-white transition active:scale-95"
          onClick={() => {
            setStatus("Locating…");
            backend
              ?.locationCurrent()
              .then((p) => choose({ name: "Current location", ...p }))
              .catch((e: unknown) => setStatus(e instanceof Error ? e.message : String(e)));
          }}
        >
          <PinIcon size={13} /> Use my location
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        {results.map((r) => (
          <button
            key={`${r.latitude},${r.longitude}`}
            type="button"
            onClick={() => choose(r)}
            className="truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] text-white/80 hover:bg-white/10"
          >
            {r.name}
          </button>
        ))}
        {status && <div className="px-2 py-1 text-[12px] text-white/45">{status}</div>}
      </div>
      {canCancel && (
        <button type="button" onClick={onDone} className="self-end text-[11px] text-white/40 hover:text-white">
          Cancel
        </button>
      )}
    </div>
  );
}
