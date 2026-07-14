import { matchItemType, matchMoc } from './itemTypePatterns';
import { validateItem } from './aiValidator';
import { extractSizeFromItemName, allowedSizes } from './sizeExtractor';

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== 'false';

const SIZE_NOT_FOUND = "Not detectable";

const MOC_STANDARDIZE: Record<string, string> = {
  "DUCTILE IRON": "DUCTILE IRON/CAST IRON",
  "CAST IRON": "DUCTILE IRON/CAST IRON",
  "GALVANIZED IRON": "GALVANISED",
  "CARBON STEEL": "CAST STEEL/CARBON STEEL",
}

export interface ResolveResult {
  itemType: string | null;
  moc: string | null;
  size: string | null;
  itemTypeSource: 'sheet' | 'keyword' | 'ai' | null;
  mocSource: 'sheet' | 'keyword' | 'ai' | null;
}

function normalizeSize(val: string): string {
  const trimmed = val.trim().toLowerCase();
  if (
    trimmed === "" ||
    trimmed.includes("not mentioned") ||
    trimmed.includes("not found") ||
    trimmed.includes("can't detect") ||
    trimmed.includes("cannot detect") ||
    trimmed.includes("unknown") ||
    trimmed.includes("no size")
  ) {
    return SIZE_NOT_FOUND;
  }
  return val.trim();
}

export async function resolveItemCategory(params: {
  itemName?: string | null;
  sheetItemType?: string | null;
  sheetMoc?: string | null;
  sheetSize?: string | null;
}): Promise<ResolveResult> {
  const { itemName, sheetItemType, sheetMoc, sheetSize } = params;

  const result: ResolveResult = {
    itemType: sheetItemType || null,
    moc: sheetMoc || null,
    size: sheetSize || null,
    itemTypeSource: sheetItemType ? 'sheet' : null,
    mocSource: sheetMoc ? 'sheet' : null,
  };

  if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
    if (!result.size) {
      result.size = SIZE_NOT_FOUND;
    }
    return result;
  }

  const keywordType = matchItemType(itemName);
  const keywordMoc = matchMoc(itemName);
  const keywordSize = extractSizeFromItemName(itemName);

  if (keywordType) {
    result.itemType = keywordType;
    result.itemTypeSource = 'keyword';
  }
  if (keywordMoc) {
    result.moc = keywordMoc;
    result.mocSource = 'keyword';
  }
  if (keywordSize) {
    result.size = keywordSize;
  }

  if (VALIDATION_ENABLED) {
    const aiResult = await validateItem(itemName, result.itemType, result.moc, result.size);
    if (aiResult) {
      if (aiResult.itemType?.category) {
        result.itemType = aiResult.itemType.category.toUpperCase();
        result.itemTypeSource = 'ai';
      }
      if (aiResult.moc?.material) {
        let mocVal = aiResult.moc.material.trim().toUpperCase();
        if (MOC_STANDARDIZE[mocVal]) {
          mocVal = MOC_STANDARDIZE[mocVal];
        }
        if (mocVal && mocVal !== 'UNKNOWN') {
          result.moc = mocVal;
          result.mocSource = 'ai';
        }
      }
      if (aiResult.size?.value) {
        const sizeVal = normalizeSize(aiResult.size.value);
        if (sizeVal === SIZE_NOT_FOUND && !keywordSize) {
          result.size = SIZE_NOT_FOUND;
        } else if (sizeVal !== SIZE_NOT_FOUND) {
          result.size = sizeVal;
        }
      }
      return result;
    }
  }

  if (!result.size) {
    result.size = SIZE_NOT_FOUND;
  }

  return result;
}
