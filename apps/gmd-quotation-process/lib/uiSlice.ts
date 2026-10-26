import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 160,  // Contract Review
  4: 130,  // Enquiry Type
  5: 200,  // State/Utility
  6: 210,  // Payment Terms / PBG / Inspection
  7: 200,  // Email Address
  8: 140,  // Contact No
  9: 130,  // Order Status
  10: 140, // Closure Status
  11: 160, // Project Reference
  12: 160, // Technical Evaluation
  13: 160, // Reverse Auction
  14: 300, // Item Name As Per Party
  15: 400, // Details
  16: 110, // Quantity
  17: 140, // Item Code
  18: 140, // BOM ID
  19: 110, // Product Cost
  20: 120, // Cost Ref Code
  21: 130, // Cost
  22: 120, // Stock Status
  23: 120, // Stock Quantity
  24: 140, // Available Stock
  25: 140, // View Image
  26: 100, // Stock Against Contract
  27: 120, // Discount
  28: 150, // VA%
  29: 120, // Quoted Rate
  30: 140, // Rate (Contract Review)
  31: 140, // PD Cost Val
  32: 140, // QR incl. GST
  33: 240, // Item Name (Merge)
  34: 140, // Total Value incl. GST
  35: 140, // Itemwise Total Value
  36: 170, // Validation
  37: 140, // Delivery Schedule
  38: 170, // APM
  39: 150, // Offer PDF
  40: 150, // Send Email
  41: 80,  // Actions
};

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
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
    toggleAnalyticsSidebar(state) {
      state.isAnalyticsSidebarCollapsed = !state.isAnalyticsSidebarCollapsed;
    },
    setAnalyticsSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.isAnalyticsSidebarCollapsed = action.payload;
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
  toggleAnalyticsSidebar,
  setAnalyticsSidebarCollapsed,
  setGeneratedImages,
  toggleEnquirySelection,
  setSelectedEnquiries,
  clearEnquirySelection,
  setClosedBomIds,
} = uiSlice.actions;

export default uiSlice.reducer;
