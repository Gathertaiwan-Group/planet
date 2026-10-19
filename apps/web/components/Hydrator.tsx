"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";

/** 掛載後才從 localStorage 還原（避免 SSR hydration mismatch） */
export function Hydrator() {
  useEffect(() => {
    const done = () => useStore.setState({ hydrated: true });
    try {
      const r = useStore.persist.rehydrate();
      if (r && typeof (r as Promise<void>).then === "function") (r as Promise<void>).then(done, done);
      else done();
    } catch {
      done();
    }
  }, []);
  return null;
}
