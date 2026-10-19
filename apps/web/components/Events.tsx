"use client";

import { useEffect, useState } from "react";
import { eventDateParts, nt, seatText, TYPE_COLORS, type PlanetEvent } from "@planet/shared";
import { useStore } from "@/lib/store";
import { sx } from "@/lib/sx";

type PlanetName = { id: number; name: string };

function useEventView(e: PlanetEvent, planets: PlanetName[]) {
  const registered = useStore((s) => s.hydrated && s.regs.includes(e.slug));
  const seats = useStore((s) => s.seats[e.slug] ?? e.seats_left);
  const openReg = useStore((s) => s.openReg);
  const d = eventDateParts(e.starts_at);
  const t = TYPE_COLORS[e.type];
  const full = !registered && seats <= 0;
  const st = seatText(seats);
  return {
    ...d,
    typeLabel: e.type === "same" ? `同星球 · ${planets.find((p) => p.id === e.planet_id)?.name ?? ""}` : e.type === "cross" ? "跨星球" : "所有人",
    tagBg: t.bg,
    tagColor: t.color,
    priceText: nt(e.price_twd),
    seatText: st.text,
    seatColor: st.color,
    btnLabel: registered ? "已報名 ✓" : full ? "已額滿" : "報名",
    btnBg: registered ? "#2a3358" : full ? "#222b4f" : "#f0c96e",
    btnColor: registered ? "#9fd8c4" : full ? "#8e90a8" : "#10162e",
    disabled: registered || full,
    onReg: () => {
      if (!registered && !full) openReg({ ...e, seats_left: seats });
    },
  };
}

export function HomeEventCard({ e, planets }: { e: PlanetEvent; planets: PlanetName[] }) {
  const v = useEventView(e, planets);
  return (
    <div style={sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:24px;display:flex;flex-direction:column;gap:14px")}>
      <div style={sx("display:flex;justify-content:space-between;align-items:center;gap:12px")}>
        <span style={sx("font-size:15px;font-weight:600;color:#f0c96e")}>{v.dateText}</span>
        <span style={sx("font-size:13px;font-weight:600;border-radius:999px;padding:4px 10px", { background: v.tagBg, color: v.tagColor })}>{v.typeLabel}</span>
      </div>
      <span style={sx("font-size:21px;font-weight:700;line-height:1.35")}>{e.title}</span>
      <span style={sx("font-size:15px;color:#cfcbe0")}>
        {e.city} · {v.time}
      </span>
      <button
        type="button"
        onClick={v.onReg}
        disabled={v.disabled}
        aria-label={`${v.btnLabel}：${e.title}`}
        className={v.disabled ? "tap" : "h-bg-gold tap"}
        style={sx("margin-top:auto;align-self:flex-start;border:0;border-radius:999px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer", { background: v.btnBg, color: v.btnColor })}
      >
        {v.btnLabel}
      </button>
    </div>
  );
}

function EventRow({ e, planets }: { e: PlanetEvent; planets: PlanetName[] }) {
  const v = useEventView(e, planets);
  return (
    <div style={sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:20px;display:flex;flex-wrap:wrap;gap:20px;align-items:center")}>
      <div style={sx("flex:0 0 84px;width:84px;height:84px;border-radius:20px;background:#222b4f;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px")}>
        <span style={sx("font-size:13px;color:#aeb0c6")}>{v.mon}</span>
        <span style={sx("font-size:32px;font-weight:700;color:#f0c96e;line-height:1")}>{v.day}</span>
        <span style={sx("font-size:12px;color:#aeb0c6")}>{v.dow}</span>
      </div>
      <div style={sx("flex:1 1 260px;display:flex;flex-direction:column;gap:8px;min-width:0")}>
        <div style={sx("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
          <span style={sx("font-size:13px;font-weight:600;border-radius:999px;padding:4px 10px", { background: v.tagBg, color: v.tagColor })}>{v.typeLabel}</span>
          <span style={sx("font-size:14px;color:#aeb0c6")}>
            {e.city} · {v.time}
          </span>
        </div>
        <span style={sx("font-size:20px;font-weight:700;line-height:1.35")}>{e.title}</span>
        <span style={sx("font-size:15px;line-height:1.6;color:#cfcbe0")}>{e.description}</span>
      </div>
      <div className="ev-side" style={sx("flex:1 0 auto;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:flex-end")}>
        <span style={sx("font-size:17px;font-weight:600")}>{v.priceText}</span>
        <span style={sx("font-size:13px", { color: v.seatColor })}>{v.seatText}</span>
        <button
          type="button"
          onClick={v.onReg}
          disabled={v.disabled}
          aria-label={`${v.btnLabel}：${e.title}`}
          className={v.disabled ? "tap" : "h-bg-gold tap"}
          style={sx("border:0;border-radius:999px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap", { background: v.btnBg, color: v.btnColor, marginLeft: "auto" })}
        >
          {v.btnLabel}
        </button>
      </div>
    </div>
  );
}

type Filter = "all" | "cross" | "same" | "open" | "mine";
const FILTERS: [Filter, string][] = [
  ["all", "全部"],
  ["cross", "跨星球"],
  ["same", "同星球"],
  ["open", "所有人"],
];

export function EventsList({ events, planets }: { events: PlanetEvent[]; planets: PlanetName[] }) {
  const result = useStore((s) => s.result);
  const hydrated = useStore((s) => s.hydrated);
  const [filter, setFilter] = useState<Filter>("all");

  // ?type=all|cross|same|open|mine
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type") as Filter | null;
    if (t && ["all", "cross", "same", "open", "mine"].includes(t)) setFilter(t);
  }, []);
  useEffect(() => {
    if (hydrated && filter === "mine" && result === null) setFilter("all");
  }, [hydrated, filter, result]);

  const choose = (f: Filter) => {
    setFilter(f);
    const url = new URL(window.location.href);
    if (f === "all") url.searchParams.delete("type");
    else url.searchParams.set("type", f);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };

  const filters = FILTERS.concat(result !== null ? [["mine", "適合我的"]] : []);
  const list = events.filter(
    (e) => filter === "all" || e.type === filter || (filter === "mine" && (e.type !== "same" || e.planet_id === result)),
  );

  return (
    <>
      <div role="group" aria-label="篩選聚會" style={sx("display:flex;gap:8px;flex-wrap:wrap")}>
        {filters.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => choose(k)}
            className="tap"
            style={sx("border:1.5px solid #3d4672;border-radius:999px;padding:9px 18px;font-size:15px;font-weight:600;cursor:pointer", {
              background: filter === k ? "#f0c96e" : "transparent",
              color: filter === k ? "#10162e" : "#f6f0e1",
            })}
          >
            {l}
          </button>
        ))}
      </div>
      <div style={sx("display:flex;flex-direction:column;gap:14px")}>
        {list.map((e) => (
          <EventRow key={e.slug} e={e} planets={planets} />
        ))}
        {list.length === 0 && <span style={sx("color:#aeb0c6;font-size:16px;padding:12px 0")}>目前沒有符合的聚會，晚點再來看看。</span>}
      </div>
    </>
  );
}
