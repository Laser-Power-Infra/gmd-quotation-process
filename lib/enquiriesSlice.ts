import {
  createSlice,
  createAsyncThunk,
  createEntityAdapter,
  createSelector,
} from "@reduxjs/toolkit";
import type { RootState } from "./store";
import type { EnquiryData, EnquiryItemData } from "./types";
import { updateEnquiryFieldAction, updateItemFieldAction, createNewEnquiryAction } from "@/app/actions";

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

const enquiriesAdapter = createEntityAdapter<EnquiryData>({
  sortComparer: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
});

const itemsAdapter = createEntityAdapter<EnquiryItemData>();

interface EnquiriesState {
  enquiries: ReturnType<typeof enquiriesAdapter.getInitialState>;
  items: ReturnType<typeof itemsAdapter.getInitialState>;
  loading: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  updateStatus: "idle" | "loading" | "succeeded" | "failed";
  updateError: string | null;
  createStatus: "idle" | "loading" | "succeeded" | "failed";
  createError: string | null;
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
  (items, enquiryId) => items.filter((item) => item.enquiryId === enquiryId)
);

export const selectEnquiriesLoading = (state: RootState) => state.enquiries.loading;
export const selectEnquiriesError = (state: RootState) => state.enquiries.error;
export const selectUpdateStatus = (state: RootState) => state.enquiries.updateStatus;
export const selectUpdateError = (state: RootState) => state.enquiries.updateError;
export const selectCreateStatus = (state: RootState) => state.enquiries.createStatus;
export const selectCreateError = (state: RootState) => state.enquiries.createError;

export default enquiriesSlice.reducer;
