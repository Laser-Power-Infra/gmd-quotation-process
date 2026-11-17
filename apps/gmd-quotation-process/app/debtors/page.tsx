"use client";

import { useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { DebtorsPage } from "@gmd/debtors/ui";
import { syncLedgerAction } from "@/app/actions/ledgerSync";
import { LEGAL_STATUSES } from "@/lib/legalStatus";
import * as actions from "./actions";

const statementUrl = (accCode: string) => `/api/debtors/${encodeURIComponent(accCode)}/interest-statement`;

export default function Page() {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remounting the page after a sync reloads the table and the sidebar; filters live in Redux and survive.
  const [reloadKey, setReloadKey] = useState(0);

  const onSync = async () => {
    setSyncing(true);
    const result = await syncLedgerAction();
    if (result.success) {
      setError(null);
      setReloadKey((k) => k + 1);
    } else {
      setError(result.error);
    }
    setSyncing(false);
  };

  return (
    <main className="flex-1 min-h-0 min-w-0 flex flex-col bg-background overflow-hidden">
      <DebtorsPage
        key={reloadKey}
        actions={{ ...actions }}
        legalStatuses={LEGAL_STATUSES}
        statementUrl={statementUrl}
        header={(s) => (
          <>
            <GMDUpdateHeader title="DEBTORS" totalRows={s?.parties ?? 0} syncedAt={s?.syncedAt ?? undefined} onSync={onSync} syncing={syncing} warnIfStale />
            {error && <div className="px-6 pb-3 text-sm text-red-600">{error}</div>}
          </>
        )}
      />
    </main>
  );
}
