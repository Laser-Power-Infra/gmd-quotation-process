import { configureStore } from "@reduxjs/toolkit";
import enquiriesReducer from "./enquiriesSlice";
import filtersReducer from "./filtersSlice";
import paginationReducer from "./paginationSlice";
import uiReducer from "./uiSlice";
import dialogsReducer from "./dialogsSlice";
import gmdUpdateReducer from "./gmdUpdateSlice";
import supplyHistoryFiltersReducer from "./supplyHistoryFiltersSlice";
import bisStatusFiltersReducer from "./bisStatusFiltersSlice";
import physicalStockTableReducer from "@gmd/physical-stock/state";
import purchaseTableReducer from "@gmd/purchase/state";
import readyToBillReducer from "@gmd/stock-allocation/state";
import purchaseViewReducer from "@gmd/stock-allocation/purchase-state";
import valveSerialTableReducer from "@gmd/valve-serial/state";
import executionRegistersReducer from "@gmd/execution-registers/state";
import debtorsTableReducer from "@gmd/debtors/state";
import serviceOrdersReducer from "@gmd/service-orders/state";
import actuatorMappingReducer from "@gmd/actuator-mapping/state";
import pendingDocketsReducer from "@gmd/pending-dockets/state";
import orderStatusReducer from "@gmd/order-status/state";
import salesRegisterReducer from "@gmd/sales-register/state";
import inspectionReportsTableReducer from "@gmd/inspection-reports/state";
import drawingsTableReducer from "@gmd/drawings/state";

export const makeStore = () => {
  return configureStore({
    reducer: {
      enquiries: enquiriesReducer,
      filters: filtersReducer,
      pagination: paginationReducer,
      ui: uiReducer,
      dialogs: dialogsReducer,
      gmdUpdate: gmdUpdateReducer,
      supplyHistoryFilters: supplyHistoryFiltersReducer,
      bisStatusFilters: bisStatusFiltersReducer,
      physicalStockTable: physicalStockTableReducer,
      purchaseTable: purchaseTableReducer,
      readyToBill: readyToBillReducer,
      purchaseView: purchaseViewReducer,
      valveSerialTable: valveSerialTableReducer,
      executionRegisters: executionRegistersReducer,
      debtorsTable: debtorsTableReducer,
      serviceOrders: serviceOrdersReducer,
      actuatorMapping: actuatorMappingReducer,
      pendingDockets: pendingDocketsReducer,
      orderStatus: orderStatusReducer,
      salesRegister: salesRegisterReducer,
      inspectionReportsTable: inspectionReportsTableReducer,
      drawingsTable: drawingsTableReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
