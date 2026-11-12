import DataSourcesPageClient from "@/components/data-sources/DataSourcesPageClient";
import { DATA_SOURCES, resolveSheetId } from "@/lib/data-sources";
import { istTime, readSyncHealth } from "@/schedular_function/job-heartbeat";

export const metadata = {
  title: "Data Sources",
};

// The Sync Health list reads the job heartbeats on every request.
export const dynamic = "force-dynamic";

/**
 * Spreadsheet IDs come from env vars, which only exist on the server. Resolve
 * them here and hand the client plain data, otherwise the server-rendered
 * markup and the client render disagree on whether an env var is configured.
 * Times are formatted here for the same reason.
 */
export default async function DataSourcesPage() {
  const rows = DATA_SOURCES.map((source) => ({
    source,
    sheetId: resolveSheetId(source),
    envMissing:
      !!source.envVar && !source.sheetId && !process.env[source.envVar],
  }));
  // The catalogue needs no DB, so a failed heartbeat read must not take the page down.
  const heartbeats = await readSyncHealth().catch((err) => {
    console.error("[data-sources] sync health read failed", err);
    return [];
  });
  const health = heartbeats.map((h) => ({
    job: h.job,
    status: h.status,
    lastRun: h.lastRun ? istTime(h.lastRun) : "Never",
    age: h.ageHours === null ? "—" : `${h.ageHours.toFixed(1)} h`,
  }));

  return <DataSourcesPageClient rows={rows} health={health} />;
}
