"use server";

import { getUtilityOptions } from "@gmd/contract-review/server/utility";
import { withLog } from "@/lib/activity-logger";

/** Standard utility names (quotation DB LookupOption UTILITY) for the dashboard filters. A read, so nothing is logged. */
export const getUtilityOptionsAction = withLog(getUtilityOptions, () => null);
