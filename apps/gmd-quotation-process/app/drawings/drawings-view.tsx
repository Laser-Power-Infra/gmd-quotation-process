"use client";

import { DrawingsPage, type DrawingRights, type DrawingsPageActions } from "@gmd/drawings/ui";
import * as server from "./actions";

/** The Server Actions under the names the package UI calls; the Contract Review window can reuse it. */
export const drawingActions: DrawingsPageActions = {
  loadPage: server.loadPage,
  loadFacet: server.loadFacet,
  loadContract: server.loadContractDrawings,
  suggestNo: server.suggestDrawingNo,
  create: server.createDrawingEntry,
  attach: server.attachDrawingFiles,
  // Still one Server Action that uploads and moves; the PDFs travel as Files, as attach sends them.
  changeStatus: (drawingId, { files, links, ...step }) => server.changeDrawingStatus(drawingId, step, files, links),
  newRevision: server.newDrawingRevision,
};

export function DrawingsView({ rights }: { rights: DrawingRights }) {
  return <DrawingsPage actions={drawingActions} rights={rights} />;
}
