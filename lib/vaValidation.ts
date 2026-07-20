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

  if (type === "AIR CUSHION VALVE") {
    return { isValid: vaPercent <= 75, maxVaPercent: 75 };
  }

  if (type === "AIR VALVE") {
    return { isValid: vaPercent <= 35, maxVaPercent: 35 };
  }

  if (type === "ALTITUDE CONTROL VALVE") {
    return { isValid: vaPercent <= 200, maxVaPercent: 200 };
  }

  if (type === "BALL VALVE") {
    return { isValid: vaPercent <= 50, maxVaPercent: 50 };
  }

  if (type === "BUSH") {
    return { isValid: vaPercent <= 100, maxVaPercent: 100 };
  }

  if (type === "COMPANION FLANGE") {
    return { isValid: vaPercent <= 15, maxVaPercent: 15 };
  }

  if (type === "DISMANTLING JOINT") {
    return { isValid: vaPercent <= 15, maxVaPercent: 15 };
  }

  if (type === "EXPANSION BELLOWS") {
    return { isValid: vaPercent <= 15, maxVaPercent: 15 };
  }

  if (type === "FLOAT VALVE") {
    return { isValid: vaPercent <= 15, maxVaPercent: 15 };
  }

  if (type === "FOOT VALVE") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "GASKET") {
    return { isValid: vaPercent <= 40, maxVaPercent: 40 };
  }

  if (type === "GATE VALVE") {
    let maxVa: number;
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) maxVa = 35;
    else if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1200) maxVa = 40;
    else maxVa = 30;
    return { isValid: vaPercent <= maxVa, maxVaPercent: maxVa };
  }

  if (type === "GEAR BOX") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "GLOBE VALVE") {
    return { isValid: vaPercent <= 40, maxVaPercent: 40 };
  }

  if (type === "KNEE GATE VALVE") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "O-RING") {
    return { isValid: vaPercent <= 40, maxVaPercent: 40 };
  }

  if (type === "PLUG VALVE" || type === "PLUUG VALVE") {
    return { isValid: vaPercent <= 45, maxVaPercent: 45 };
  }

  if (type === "RETAINER RING") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "RING") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "SEAL RING") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "SHAFT" || type === "SHHAFT") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "SOLENOID VALVE") {
    return { isValid: vaPercent <= 50, maxVaPercent: 50 };
  }

  if (type === "SPINDLE") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "WASHER") {
    return { isValid: vaPercent <= 20, maxVaPercent: 20 };
  }

  if (type === "ZERO-VELOCITY VALVE") {
    return { isValid: vaPercent <= 50, maxVaPercent: 50 };
  }

  return { isValid: true, maxVaPercent: null };
}
