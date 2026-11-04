import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

// Positions match ENQUIRY_COLUMNS in lib/enquiryColumns.ts.
export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 320,
  1: 150,
  2: 210,
  3: 180,
  4: 170,
  5: 160,
  6: 160,
  7: 160,
  8: 240,
  9: 400,
  10: 110,
  11: 140,
  12: 140,
  13: 110,
  14: 120,
  15: 130,
  16: 120,
  17: 120,
  18: 140,
  19: 140,
  20: 100,
  21: 120,
  22: 150,
  23: 120,
  24: 140,
  25: 140,
  26: 140,
  27: 240,
  28: 140,
  29: 140,
  30: 170,
  31: 140,
  32: 170,
  33: 150,
  34: 150,
  35: 80,
};

import { COLUMN_VIEWS } from "./enquiryColumns";

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  analyticsOn: true,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  visibleColumns: [...COLUMN_VIEWS.pricing.columns],
  generatedImages: {},
  selectedEnquiryIds: [],
  closedBomIds: [],
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleRow(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.expandedRows[id] === true) {
        state.expandedRows[id] = false;
      } else if (state.expandedRows[id] === false) {
        state.expandedRows[id] = true;
      } else {
        state.expandedRows[id] = true;
      }
    },
    setRowExpanded(
      state,
      action: PayloadAction<{ id: string; expanded: boolean }>
    ) {
      state.expandedRows[action.payload.id] = action.payload.expanded;
    },
    setExpandedRows(state, action: PayloadAction<Record<string, boolean>>) {
      state.expandedRows = { ...state.expandedRows, ...action.payload };
    },
    setColumnWidth(
      state,
      action: PayloadAction<{ index: number; width: number }>
    ) {
      state.columnWidths[action.payload.index] = action.payload.width;
    },
    setVisibleColumns(state, action: PayloadAction<string[]>) {
      state.visibleColumns = action.payload;
    },
    toggleAnalyticsSidebar(state) {
      state.isAnalyticsSidebarCollapsed = !state.isAnalyticsSidebarCollapsed;
    },
    setAnalyticsSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.isAnalyticsSidebarCollapsed = action.payload;
    },
    setAnalyticsOn(state, action: PayloadAction<boolean>) {
      state.analyticsOn = action.payload;
    },
    setGeneratedImages(
      state,
      action: PayloadAction<Record<string, { url: string | null; driveFileId: string | null }>>
    ) {
      state.generatedImages = action.payload;
    },
    toggleEnquirySelection(state, action: PayloadAction<string>) {
      const id = action.payload;
      const idx = state.selectedEnquiryIds.indexOf(id);
      if (idx === -1) {
        state.selectedEnquiryIds.push(id);
      } else {
        state.selectedEnquiryIds.splice(idx, 1);
      }
    },
    setSelectedEnquiries(state, action: PayloadAction<string[]>) {
      state.selectedEnquiryIds = Array.from(new Set(action.payload));
    },
    clearEnquirySelection(state) {
      state.selectedEnquiryIds = [];
    },
    setClosedBomIds(state, action: PayloadAction<string[]>) {
      state.closedBomIds = Array.from(new Set(action.payload));
    },
  },
});

export const {
  toggleRow,
  setRowExpanded,
  setExpandedRows,
  setColumnWidth,
  setVisibleColumns,
  toggleAnalyticsSidebar,
  setAnalyticsSidebarCollapsed,
  setAnalyticsOn,
  setGeneratedImages,
  toggleEnquirySelection,
  setSelectedEnquiries,
  clearEnquirySelection,
  setClosedBomIds,
} = uiSlice.actions;

export default uiSlice.reducer;
