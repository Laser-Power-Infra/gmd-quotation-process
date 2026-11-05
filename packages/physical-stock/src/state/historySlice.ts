import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// Entry History page: the ERP code that was searched (the table is empty until
// one is) and the selected entry. Hosts register it under `entryHistory`.

export interface EntryHistoryState {
  /** Committed search; "" = nothing searched yet. */
  code: string;
  selectedId: string | null;
}

const initialState: EntryHistoryState = { code: "", selectedId: null };

const slice = createSlice({
  name: "entryHistory",
  initialState,
  reducers: {
    searchCode(s, a: PayloadAction<string>) {
      s.code = a.payload.trim().toUpperCase();
      s.selectedId = null;
    },
    selectEntry(s, a: PayloadAction<string | null>) {
      s.selectedId = a.payload;
    },
  },
});

export const { searchCode, selectEntry } = slice.actions;
export const selectEntryHistory = (s: { entryHistory: EntryHistoryState }) => s.entryHistory;
export default slice.reducer;
