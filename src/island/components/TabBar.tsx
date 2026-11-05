import { motion } from "motion/react";
import type { ReactNode } from "react";
import { TAB_BAR_H } from "../activities";
import { useIsland, type Tab } from "../store";
import { BellIcon, ChartIcon, HomeIcon, ShelfIcon, SlidersIcon, SunIcon, TimerIcon } from "./icons";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon size={15} /> },
  { id: "controls", label: "Controls", icon: <SlidersIcon size={15} /> },
  { id: "clock", label: "Clock & Calendar", icon: <TimerIcon size={15} /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon size={15} /> },
  { id: "shelf", label: "Shelf", icon: <ShelfIcon size={15} /> },
  { id: "weather", label: "Weather", icon: <SunIcon size={15} /> },
  { id: "stats", label: "System", icon: <ChartIcon size={15} /> },
];

export function TabBar() {
  const tab = useIsland((s) => s.tab);
  const setTab = useIsland((s) => s.setTab);
  const reduceMotion = useIsland((s) => s.settings.appearance.reduceMotion);

  return (
    <div role="tablist" aria-label="Island panels" className="flex items-center justify-center gap-1 pt-2" style={{ height: TAB_BAR_H }}>
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t.label}
            title={t.label}
            onClick={(e) => {
              e.stopPropagation();
              setTab(t.id);
            }}
            className={`relative grid h-[24px] w-[42px] place-items-center rounded-full transition-colors ${
              active ? "text-white" : "text-white/40 hover:text-white/75"
            }`}
          >
            {active && (
              <motion.span
                layoutId="isle-tab"
                className="absolute inset-0 rounded-full bg-white/14"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", visualDuration: 0.3, bounce: 0.25 }}
              />
            )}
            <span className="relative">{t.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
