import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 160,  // Contract Review
  4: 130,  // Enquiry Type
  5: 150,  // State
  6: 120,  // Payment Terms
  7: 150,  // Inspection
  8: 250,  // PBG
  9: 120,  // Utility
  10: 130, // Order Status
  11: 140, // Closure Status
  12: 160, // Project Reference
  13: 220, // Item Name As Per Party
  14: 110, // Quantity
  15: 230, // Item Type
  16: 220, // MOC
  17: 100, // Size
  18: 130, // Size And Height
  19: 120, // PN Rating
  20: 140, // Item Code
  21: 140, // BOM ID
  22: 110, // Operation Type
  23: 100, // Extension
  24: 110, // Bypass
  25: 130, // Other
  26: 110, // Product Cost
  27: 120, // Cost Ref Code
  28: 130, // Cost
  29: 100, // Cost Logic
  30: 120, // Stock Status
  31: 120, // Stock Quantity
  32: 140, // Available Stock
  33: 140, // RM Type
  34: 120, // View Image
  35: 100, // Stock Against Contract
  36: 120, // Discount
  37: 150, // VA%
  38: 120, // Quoted Rate
  39: 140, // Rate (Contract Review)
  40: 140, // PD Cost Val
  41: 140, // QR incl. GST
  42: 240, // Item Name (Merge)
  43: 140, // Total Value incl. GST
  44: 140, // Itemwise Total Value
  45: 170, // Validation
  46: 180, // Attachment
  47: 140, // Delivery Schedule
  48: 170, // APM
  49: 150, // Offer PDF
  50: 80,  // Actions
};

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  generatedImages: {},
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
} = uiSlice.actions;

export default uiSlice.reducer;
