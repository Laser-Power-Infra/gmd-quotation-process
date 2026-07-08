/**
 * Stateful parser to parse clipboard text copied from Excel, Google Sheets, PDF, Word, or BOQs.
 * It merges wrapped multi-line descriptions and extracts the final numeric value as the quantity.
 */
export interface ParsedItem {
  itemName: string;
  quantity: number;
}

export function parseClipboardText(text: string): ParsedItem[] {
  const result: ParsedItem[] = [];
  let accumulatedDesc: string[] = [];

  const cleanDescription = (desc: string): string => {
    return desc
      .replace(/^\d+[\s\.)\-]+/g, "") // Clean leading list numbers like "1.", "2)", "3-"
      .replace(/^['"\s]+|['"\s]+$/g, "") // Strip leading/trailing quotes and spaces
      .replace(/\s+/g, " ") // Normalize multiple spaces
      .trim();
  };

  const flushAccumulator = (qty: number) => {
    if (accumulatedDesc.length > 0) {
      const mergedName = cleanDescription(accumulatedDesc.join(" "));
      if (mergedName && !isNaN(qty) && qty > 0) {
        result.push({ itemName: mergedName, quantity: qty });
      }
      accumulatedDesc = [];
    }
  };

  // Split text into lines
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;

    // Case 1: Tab-separated (typically Excel/Sheets)
    if (rawLine.includes("\t")) {
      const cells = rawLine.split("\t").map(c => c.trim()).filter(Boolean);
      if (cells.length > 0) {
        // Find the last cell that is a valid number (from right to left)
        let qtyIdx = -1;
        let qtyVal = NaN;

        for (let j = cells.length - 1; j >= 0; j--) {
          const val = parseFloat(cells[j].replace(/,/g, "")); // Handle commas in numbers like "1,000"
          if (!isNaN(val) && val > 0 && /^\d+$/.test(cells[j].replace(/,/g, ""))) {
            qtyIdx = j;
            qtyVal = val;
            break;
          }
        }

        if (qtyIdx !== -1) {
          // If we had accumulated text before this spreadsheet row, flush it with default qty 1
          if (accumulatedDesc.length > 0) {
            flushAccumulator(1);
          }
          // The other cells form the item name
          const nameCells = cells.filter((_, idx) => idx !== qtyIdx);
          const name = cleanDescription(nameCells.join(" "));
          if (name && qtyVal > 0) {
            result.push({ itemName: name, quantity: qtyVal });
          }
        } else {
          // Treat as a regular description line
          accumulatedDesc.push(cells.join(" "));
        }
      }
      continue;
    }

    // Case 2: Purely numeric line (quantity on its own line after description)
    const pureNum = parseFloat(trimmedLine.replace(/,/g, ""));
    if (!isNaN(pureNum) && /^\d+$/.test(trimmedLine.replace(/,/g, ""))) {
      if (accumulatedDesc.length > 0) {
        flushAccumulator(pureNum);
      }
      continue;
    }

    // Case 3: Line ends with a quantity (e.g. description followed by quantity)
    // Matches whitespace followed by digits (allowing commas) at the end of the line
    const match = trimmedLine.match(/(.*?)\s+(\d[\d,]*)$/);
    if (match) {
      const descPart = match[1].trim();
      const qtyPart = parseInt(match[2].replace(/,/g, ""), 10);

      if (descPart) {
        accumulatedDesc.push(descPart);
      }
      flushAccumulator(qtyPart);
    } else {
      // Case 4: Wrapped description line with no quantity
      accumulatedDesc.push(trimmedLine);
    }
  }

  // Flush any leftover accumulated description with quantity 1
  if (accumulatedDesc.length > 0) {
    flushAccumulator(1);
  }

  return result;
}
