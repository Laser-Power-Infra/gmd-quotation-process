export interface VaValidationResult {
  isValid: boolean;
  maxVaPercent: number | null;
}

function parseSize(size: string | null | undefined): number | null {
  if (!size) return null;
  const cleaned = size.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

export function validateVaPercent(
  itemType: string | null | undefined,
  size: string | null | undefined,
  vaPercent: number | null | undefined
): VaValidationResult {
  if (vaPercent === null || vaPercent === undefined) {
    return { isValid: true, maxVaPercent: null };
  }

  const type = (itemType || "").toUpperCase().trim();
  const sizeNum = parseSize(size);

  if (type === "BUTTERFLY VALVE") {
    let maxVa: number;
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) maxVa = 50;
    else if (sizeNum !== null && sizeNum > 450 && sizeNum <= 1000) maxVa = 35;
    else maxVa = 65;
    return { isValid: vaPercent <= maxVa, maxVaPercent: maxVa };
  }

  if (
    type === "SLUICE VALVE-RESILIENT-NON-RISING" ||
    type === "SLUICE VALVE-RESILIENT-RISING"
  ) {
    let maxVa: number;
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 200) maxVa = 25;
    else if (sizeNum !== null && sizeNum >= 250 && sizeNum <= 450) maxVa = 20;
    else if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1000) maxVa = 30;
    else maxVa = 30;
    return { isValid: vaPercent <= maxVa, maxVaPercent: maxVa };
  }

  if (
    type === "SLUICE VALVE-METAL-NON-RISING" ||
    type === "SLUICE VALVE-METAL-RISING"
  ) {
    let maxVa: number;
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) maxVa = 35;
    else if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1200) maxVa = 40;
    else maxVa = 30;
    return { isValid: vaPercent <= maxVa, maxVaPercent: maxVa };
  }

  if (type === "TPAV") {
    return { isValid: vaPercent <= 35, maxVaPercent: 35 };
  }

  if (type === "PRESSURE RELIEF VALVE") {
    return { isValid: vaPercent <= 200, maxVaPercent: 200 };
  }

  if (type === "CHECK VALVE") {
    return { isValid: vaPercent <= 200, maxVaPercent: 200 };
  }

  if (type === "DPCV") {
    return { isValid: vaPercent <= 15, maxVaPercent: 15 };
  }

  return { isValid: true, maxVaPercent: null };
}
