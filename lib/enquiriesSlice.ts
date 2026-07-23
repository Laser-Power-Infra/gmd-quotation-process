import {
  createSlice,
  createAsyncThunk,
  createEntityAdapter,
  createSelector,
} from "@reduxjs/toolkit";
import type { RootState } from "./store";
import type { EnquiryData, EnquiryItemData } from "./types";
import {
  updateEnquiryFieldAction,
  updateItemFieldAction,
  createNewEnquiryAction,
  addItemsAction,
  updateEnquiryItemAction,
  deleteEnquiryItemAction,
  importExcelDataAction,
  autoFillBlanksAction,
} from "@/app/actions";

export const createEnquiry = createAsyncThunk(
  "enquiries/createEnquiry",
  async (
    payload: Parameters<typeof createNewEnquiryAction>[0],
    { rejectWithValue }
  ) => {
    const result = await createNewEnquiryAction(payload);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to create enquiry");
    }
    return result.data!;
  }
);

export const updateEnquiryField = createAsyncThunk(
  "enquiries/updateEnquiryField",
  async (
    payload: { enquiryId: string; field: string; value: any },
    { rejectWithValue }
  ) => {
    const result = await updateEnquiryFieldAction(
      payload.enquiryId,
      payload.field,
      payload.value
    );
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to update enquiry field");
    }
    return result.data!;
  }
);

export const updateItemField = createAsyncThunk(
  "enquiries/updateItemField",
  async (
    payload: { itemId: string; field: string; value: any },
    { rejectWithValue }
  ) => {
    const result = await updateItemFieldAction(payload.itemId, payload.field, payload.value);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to update item field");
    }
    return result.data!;
  }
);

export const addItems = createAsyncThunk(
  "enquiries/addItems",
  async (
    payload: Parameters<typeof addItemsAction>[0],
    { rejectWithValue }
  ) => {
    const result = await addItemsAction(payload);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to add items");
    }
    return result.data!;
  }
);

export const updateEnquiryItem = createAsyncThunk(
  "enquiries/updateEnquiryItem",
  async (
    payload: Parameters<typeof updateEnquiryItemAction>[0],
    { rejectWithValue }
  ) => {
    const result = await updateEnquiryItemAction(payload);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to update enquiry item");
    }
    return result.data!;
  }
);

export const deleteEnquiryItem = createAsyncThunk(
  "enquiries/deleteEnquiryItem",
  async (
    itemId: string,
    { rejectWithValue }
  ) => {
    const result = await deleteEnquiryItemAction(itemId);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to delete item");
    }
    return result.data!;
  }
);

export const importExcelData = createAsyncThunk(
  "enquiries/importExcelData",
  async (
    payload: Parameters<typeof importExcelDataAction>[0],
    { rejectWithValue }
  ) => {
    const result = await importExcelDataAction(payload);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to import excel data");
    }
    return result.data!;
  }
);

export const autoFillBlanks = createAsyncThunk(
  "enquiries/autoFillBlanks",
  async (
    payload: Parameters<typeof autoFillBlanksAction>[0],
    { rejectWithValue }
  ) => {
    const result = await autoFillBlanksAction(payload);
    if (!result.success) {
      return rejectWithValue(result.error || "Failed to auto-fill blanks");
    }
    return result.data!;
  }
);

const enquiriesAdapter = createEntityAdapter<EnquiryData>({
  sortComparer: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
});

const itemsAdapter = createEntityAdapter<EnquiryItemData>({
  sortComparer: (a, b) => a.position - b.position,
});

interface EnquiriesState {
  enquiries: ReturnType<typeof enquiriesAdapter.getInitialState>;
  items: ReturnType<typeof itemsAdapter.getInitialState>;
  loading: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  updateStatus: "idle" | "loading" | "succeeded" | "failed";
  updateError: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
  addItemsStatus: "idle" | "loading" | "succeeded" | "failed";
  addItemsError: string | null;
  deleteStatus: "idle" | "loading" | "succeeded" | "failed";
  deleteError: string | null;
  importStatus: "idle" | "loading" | "succeeded" | "failed";
  importError: string | null;
  autoFillStatus: "idle" | "loading" | "succeeded" | "failed";
  autoFillError: string | null;
}

const initialState: EnquiriesState = {
  enquiries: enquiriesAdapter.getInitialState(),
  items: itemsAdapter.getInitialState(),
  loading: "idle",
  error: null,
  updateStatus: "idle",
  updateError: null,
  createStatus: "idle",
  createError: null,
  addItemsStatus: "idle",
  addItemsError: null,
  deleteStatus: "idle",
  deleteError: null,
  importStatus: "idle",
  importError: null,
  autoFillStatus: "idle",
  autoFillError: null,
};

const enquiriesSlice = createSlice({
  name: "enquiries",
  initialState,
  reducers: {
    hydrateFromServer(state, action) {
      const { enquiries, items } = action.payload as {
        enquiries: EnquiryData[];
        items: EnquiryItemData[];
      };
      enquiriesAdapter.setAll(state.enquiries, enquiries);
      itemsAdapter.setAll(state.items, items);
      state.loading = "succeeded";
    },
    setLoading(state, action) {
      state.loading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(createEnquiry.pending, (state) => {
        state.createStatus = "loading";
        state.createError = null;
      })
      .addCase(createEnquiry.fulfilled, (state, action) => {
        const payload = action.payload as any;
        enquiriesAdapter.addOne(state.enquiries, payload);
        itemsAdapter.addMany(state.items, payload.items);
        state.createStatus = "succeeded";
      })
      .addCase(createEnquiry.rejected, (state, action) => {
        state.createStatus = "failed";
        state.createError = (action.payload as string) || "Create failed";
      })
      .addCase(updateEnquiryField.fulfilled, (state, action) => {
        const { enquiry, items } = action.payload;
        enquiriesAdapter.upsertOne(state.enquiries, enquiry);
        if (items && items.length > 0) {
          itemsAdapter.upsertMany(state.items, items);
          const storedEnquiry = state.enquiries.entities[enquiry.id];
          if (storedEnquiry) {
            storedEnquiry.items = items;
          }
        }
      })
      .addCase(updateEnquiryField.rejected, (state, action) => {
        state.updateStatus = "failed";
        state.updateError = (action.payload as string) || "Update failed";
      })
      .addCase(updateItemField.fulfilled, (state, action) => {
        const updatedItem = action.payload;
        itemsAdapter.upsertOne(state.items, updatedItem);
        const parentEnquiry = state.enquiries.entities[updatedItem.enquiryId];
        if (parentEnquiry) {
          const idx = parentEnquiry.items.findIndex((i) => i.id === updatedItem.id);
          if (idx !== -1) {
            parentEnquiry.items[idx] = updatedItem;
          }
        }
      })
      .addCase(updateItemField.rejected, (state, action) => {
        state.updateStatus = "failed";
        state.updateError = (action.payload as string) || "Update failed";
      })
      .addCase(addItems.pending, (state) => {
        state.addItemsStatus = "loading";
        state.addItemsError = null;
      })
      .addCase(addItems.fulfilled, (state, action) => {
        const { enquiryId, items } = action.payload;
        itemsAdapter.addMany(state.items, items);
        const storedEnquiry = state.enquiries.entities[enquiryId];
        if (storedEnquiry) {
          storedEnquiry.items = items;
        }
        state.addItemsStatus = "succeeded";
      })
      .addCase(addItems.rejected, (state, action) => {
        state.addItemsStatus = "failed";
        state.addItemsError = (action.payload as string) || "Add items failed";
      })
      .addCase(updateEnquiryItem.pending, (state) => {
        state.updateStatus = "loading";
        state.updateError = null;
      })
      .addCase(updateEnquiryItem.fulfilled, (state, action) => {
        const { item, enquiry } = action.payload;
        itemsAdapter.upsertOne(state.items, item);
        enquiriesAdapter.upsertOne(state.enquiries, enquiry);
        state.updateStatus = "succeeded";
      })
      .addCase(updateEnquiryItem.rejected, (state, action) => {
        state.updateStatus = "failed";
        state.updateError = (action.payload as string) || "Update failed";
      })
      .addCase(deleteEnquiryItem.pending, (state) => {
        state.deleteStatus = "loading";
        state.deleteError = null;
      })
      .addCase(deleteEnquiryItem.fulfilled, (state, action) => {
        const { itemId, enquiryId, enquiryDeleted } = action.payload;
        itemsAdapter.removeOne(state.items, itemId);
        if (enquiryDeleted) {
          enquiriesAdapter.removeOne(state.enquiries, enquiryId);
        } else {
          const storedEnquiry = state.enquiries.entities[enquiryId];
          if (storedEnquiry) {
            storedEnquiry.items = storedEnquiry.items.filter((i) => i.id !== itemId);
          }
        }
        state.deleteStatus = "succeeded";
      })
      .addCase(deleteEnquiryItem.rejected, (state, action) => {
        state.deleteStatus = "failed";
        state.deleteError = (action.payload as string) || "Delete failed";
      })
      .addCase(importExcelData.pending, (state) => {
        state.importStatus = "loading";
        state.importError = null;
      })
      .addCase(importExcelData.fulfilled, (state, action) => {
        const { items } = action.payload;
        if (items && items.length > 0) {
          itemsAdapter.upsertMany(state.items, items);
          const updatedByEnquiry = new Map<string, any[]>();
          for (const item of items) {
            const existing = updatedByEnquiry.get(item.enquiryId) || [];
            existing.push(item);
            updatedByEnquiry.set(item.enquiryId, existing);
          }
          for (const [enqId, updatedItems] of updatedByEnquiry) {
            const storedEnquiry = state.enquiries.entities[enqId];
            if (storedEnquiry) {
              for (const updatedItem of updatedItems) {
                const idx = storedEnquiry.items.findIndex((i) => i.id === updatedItem.id);
                if (idx !== -1) {
                  storedEnquiry.items[idx] = updatedItem;
                }
              }
            }
          }
        }
        state.importStatus = "succeeded";
      })
      .addCase(importExcelData.rejected, (state, action) => {
        state.importStatus = "failed";
        state.importError = (action.payload as string) || "Import failed";
      })
      .addCase(autoFillBlanks.pending, (state) => {
        state.autoFillStatus = "loading";
        state.autoFillError = null;
      })
      .addCase(autoFillBlanks.fulfilled, (state, action) => {
        const { items } = action.payload;
        if (items && items.length > 0) {
          itemsAdapter.upsertMany(state.items, items);
          const updatedByEnquiry = new Map<string, any[]>();
          for (const item of items) {
            const existing = updatedByEnquiry.get(item.enquiryId) || [];
            existing.push(item);
            updatedByEnquiry.set(item.enquiryId, existing);
          }
          for (const [enqId, updatedItems] of updatedByEnquiry) {
            const storedEnquiry = state.enquiries.entities[enqId];
            if (storedEnquiry) {
              for (const updatedItem of updatedItems) {
                const idx = storedEnquiry.items.findIndex((i) => i.id === updatedItem.id);
                if (idx !== -1) {
                  storedEnquiry.items[idx] = updatedItem;
                }
              }
            }
          }
        }
        state.autoFillStatus = "succeeded";
      })
      .addCase(autoFillBlanks.rejected, (state, action) => {
        state.autoFillStatus = "failed";
        state.autoFillError = (action.payload as string) || "Auto-fill failed";
      });
  },
});

export const {
  hydrateFromServer,
  setLoading,
} = enquiriesSlice.actions;

export const {
  selectAll: selectAllEnquiries,
  selectById: selectEnquiryById,
  selectIds: selectEnquiryIds,
  selectEntities: selectEnquiryEntities,
  selectTotal: selectEnquiriesTotal,
} = enquiriesAdapter.getSelectors(
  (state: RootState) => state.enquiries.enquiries
);

export const {
  selectAll: selectAllItems,
  selectById: selectItemById,
  selectIds: selectItemIds,
  selectEntities: selectItemEntities,
} = itemsAdapter.getSelectors((state: RootState) => state.enquiries.items);

export const selectItemsByEnquiryId = createSelector(
  [selectAllItems, (_, enquiryId: string) => enquiryId],
  (items, enquiryId) => items.filter((item) => item.enquiryId === enquiryId).sort((a, b) => a.position - b.position)
);

export const selectEnquiriesLoading = (state: RootState) => state.enquiries.loading;
export const selectEnquiriesError = (state: RootState) => state.enquiries.error;
export const selectUpdateStatus = (state: RootState) => state.enquiries.updateStatus;
export const selectUpdateError = (state: RootState) => state.enquiries.updateError;
export const selectCreateStatus = (state: RootState) => state.enquiries.createStatus;
export const selectCreateError = (state: RootState) => state.enquiries.createError;
export const selectAddItemsStatus = (state: RootState) => state.enquiries.addItemsStatus;
export const selectAddItemsError = (state: RootState) => state.enquiries.addItemsError;
export const selectDeleteStatus = (state: RootState) => state.enquiries.deleteStatus;
export const selectDeleteError = (state: RootState) => state.enquiries.deleteError;
export const selectImportStatus = (state: RootState) => state.enquiries.importStatus;
export const selectImportError = (state: RootState) => state.enquiries.importError;
export const selectAutoFillStatus = (state: RootState) => state.enquiries.autoFillStatus;
export const selectAutoFillError = (state: RootState) => state.enquiries.autoFillError;

export default enquiriesSlice.reducer;
