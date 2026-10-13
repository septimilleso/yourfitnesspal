import { useEffect, useState } from "react";

import { offlineTimeParts } from "../lib/offlineTime";
import { isNative } from "../native/platform";
import { getPersistedCacheInfo } from "../native/queryPersistence";

interface CacheInfo {
  sizeBytes: number;
  savedAt: number;
}

/** Riga "Dati offline" in Impostazioni: peso e ora del file della cache. Sul web non rende nulla. */
export default function OfflineCacheInfo() {
  // undefined = lettura in corso, null = nessun file (o lettura fallita).
  const [info, setInfo] = useState<CacheInfo | null | undefined>(undefined);

  useEffect(() => {
    if (!isNative()) return;
    let current = true;
    void getPersistedCacheInfo().then((result) => {
      if (current) setInfo(result);
    });
    return () => {
      current = false;
    };
  }, []);

  if (!isNative() || info === undefined) return null;
  if (info === null) {
    return <p className="px-1 text-xs text-slate-500">Dati offline: nessuno</p>;
  }

  const { time, day } = offlineTimeParts(info.savedAt, new Date());
  const when = day === null ? `alle ${time}` : `il ${day} alle ${time}`;
  const kb = Math.round(info.sizeBytes / 1024);
  return <p className="px-1 text-xs text-slate-500">{`Dati offline: circa ${kb} KB, salvati ${when}`}</p>;
}
