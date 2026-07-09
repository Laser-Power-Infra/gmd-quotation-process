export interface EnquiryItemData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  enquiryId: string;
  itemName: string;
  quantity: number;
  itemType: string | null;
  moc: string | null;
  size: string | null;
  pnRating: string | null;
  operationType: string | null;
  extension: string | null;
  bypass: string | null;
  productCost: number | null;
  costRefCode: string | null;
  cost: number | null;
  stockStatus: string | null;
  discount: number | null;
  quotedRate: string | null;
  itemNameMerge: string | null;
  totalValue: string | null;
  itemWiseTotalValue: string | null;
  vaPercent: number | null;
}

export interface AttachmentData {
  id: string;
  name: string;
  url: string;
  type: string | null;
  size: number | null;
}

export interface EnquiryData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  docketNumber: string;
  partyName: string;
  enquiryDate: Date;
  enquiryType: string | null;
  state: string | null;
  paymentTerms: string | null;
  inspection: string | null;
  pbg: string | null;
  utility: string | null;
  orderStatus: string | null;
  attachments: AttachmentData[];
  items: EnquiryItemData[];
}

export interface DropdownOptions {
  enquiryTypes: string[];
  states: string[];
  paymentTerms: string[];
  inspections: string[];
  pbgs: string[];
  utilities: string[];
  vaPercents: string[];
  orderStatuses: string[];
  itemTypes: string[];
  mocs: string[];
  sizes: string[];
  pnRatings: string[];
  operationTypes: string[];
  extensions: string[];
  bypasses: string[];
}

export interface FiltersState {
  enquiryDateFrom: string;
  enquiryDateTo: string;
  docketNumber: string;
  partyNames: string[];
  enquiryType: string;
  state: string;
  paymentTerms: string;
  inspection: string;
  pbg: string;
  utility: string;
  vaPercent: string;
  orderStatus: string;
  itemName: string;
  quantity: string;
  itemType: string;
  moc: string;
  size: string;
  pnRating: string;
  operationType: string;
  extension: string;
  bypass: string;
  productCost: string;
  costRefCode: string;
  cost: string;
  stockStatus: string;
  discount: string;
  quotedRate: string;
  itemNameMerge: string;
  totalValue: string;
  itemWiseTotalValue: string;
  attachment: string;
}

export interface UiState {
  expandedRows: Record<string, boolean>;
  columnWidths: Record<number, number>;
  isPartyFilterOpen: boolean;
  partySearch: string;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
}

export interface DialogsState {
  isAddItemsOpen: boolean;
  isNewEnquiryOpen: boolean;
  viewItemId: string | null;
  editItemId: string | null;
  deleteItemId: string | null;
}

export interface UpdateEnquiryFieldPayload {
  enquiryId: string;
  field: string;
  value: any;
}

export interface UpdateItemFieldPayload {
  itemId: string;
  field: string;
  value: any;
  previousValue: any;
}
