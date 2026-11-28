import { configureStore } from "@reduxjs/toolkit";
import physicalStockTableReducer from "@gmd/physical-stock/state";
import purchaseViewReducer from "@gmd/stock-allocation/purchase-state";
import entryHistoryReducer from "@gmd/physical-stock/state/history";

export const makeStore = () =>
  configureStore({
    reducer: {
      physicalStockTable: physicalStockTableReducer,
      entryHistory: entryHistoryReducer,
      purchaseView: purchaseViewReducer,
    },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
