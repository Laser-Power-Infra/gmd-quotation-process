"use client";

import { useEffect, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import CreditorsTable from "@/components/creditors/CreditorsTable";
import type { CreditorsResult } from "@/lib/creditors";
import { syncLedgerAction } from "@/app/actions/ledgerSync";

export default function CreditorsPage() {
  const [data, setData] = useState<CreditorsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const onSync = async () => {
    setSyncing(true);
    const result = await syncLedgerAction();
    if (result.success) {
      setError(null);
      setReloadKey((k) => k + 1); // re-fetch the page data
    } else {
      setError(result.error);
    }
    setSyncing(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/creditors");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <GMDUpdateHeader title="CREDITORS" totalRows={0} syncedAt={undefined} />
        <GMDUpdateSkeleton />
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader title="CREDITORS" totalRows={data?.rows.length ?? 0} syncedAt={data?.syncedAt} onSync={onSync} syncing={syncing} warnIfStale />
      {error && <div className="px-6 py-4 text-sm text-red-600">{error}</div>}
      <div className="flex-1 min-h-0 px-6 pb-6 flex gap-4">
        <div className="flex-1 min-h-0">
          <CreditorsTable rows={data?.rows ?? []} advances={data?.advances ?? []} names={data?.names ?? {}} followUps={data?.followUps ?? {}} />
        </div>
      </div>
    </main>
  );
}
