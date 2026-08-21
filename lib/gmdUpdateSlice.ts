import {
  createSlice,
  createEntityAdapter,
  createAsyncThunk,
} from "@reduxjs/toolkit";
import type { RootState } from "./store";
import {
  updateGMDUpdateFieldAction,
  updateGMDUsdCostAction,
} from "@/app/actions";

export interface GMDUpdateRow {
  id: string;
  erpItemCode: string | null;
  itemNameAuto: string | null;
  l1: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l7Dimension: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l8ItemCategory: string | null;
  um: string | null;
  conv1: string | null;
  pcsWgt: string | null;
  aum: string | null;
  availableStock: string | null;
  cost: string | null;
  usdRateOption: string | null;
  hsnCode: string | null;
  hsnCodeValidation: string | null;
  conv2: string | null;
  majorMarking: string | null;
  newItemStatus: string | null;
  currentStatus: string | null;
  rmType: string | null;
  indianImported: string | null;
}

const adapter = createEntityAdapter<GMDUpdateRow>();

export const updateGMDUpdateField = createAsyncThunk(
  "gmdUpdate/updateField",
  async ({
    id,
    field,
    value,
  }: {
    id: string;
    field: string;
    value: string | null;
  }) => {
    return await updateGMDUpdateFieldAction(id, field, value);
  },
);

export const updateGMDUsdCost = createAsyncThunk(
  "gmdUpdate/updateUsdCost",
  async ({ id, usdCost }: { id: string; usdCost: string | null }) => {
    const result = await updateGMDUsdCostAction(id, usdCost);
    if (!result.success) {
      throw new Error(result.error || "Failed to update USD cost.");
    }
    return result.data!;
  },
);

const gmdUpdateSlice = createSlice({
  name: "gmdUpdate",
  initialState: adapter.getInitialState(),
  reducers: {
    hydrateGMDUpdate(state, action) {
      adapter.setAll(state, action.payload);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(updateGMDUpdateField.fulfilled, (state, action) => {
      const { id, field, value } = action.payload;
      adapter.updateOne(state, { id, changes: { [field]: value } });
    });
    builder.addCase(updateGMDUsdCost.fulfilled, (state, action) => {
      const { id, usdCost, cost } = action.payload;
      adapter.updateOne(state, {
        id,
        changes: { usdRateOption: usdCost, cost },
      });
    });
  },
});

export const { hydrateGMDUpdate } = gmdUpdateSlice.actions;
export const {
  selectAll: selectAllGMDUpdateRows,
  selectById: selectGMDUpdateRowById,
} = adapter.getSelectors<RootState>((state) => state.gmdUpdate);
export default gmdUpdateSlice.reducer;
