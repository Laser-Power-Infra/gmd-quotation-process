export function parseSize(size: string | null | undefined): number | null {
  if (!size) return null;
  const cleaned = size.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/** Default VA% for a new item; never below the minimum in lib/vaRules.ts (it imports this file), see tests/vaRules.test.ts. */
export function getDefaultVaPercent(
  itemType: string | null | undefined,
  size: string | null | undefined
): number | null {
  const type = (itemType || "").toUpperCase().trim();
  const sizeNum = parseSize(size);

  if (type === "BUTTERFLY VALVE") {
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) return 50;
    if (sizeNum !== null && sizeNum > 450 && sizeNum <= 1000) return 35;
    return 65;
  }

  if (type === "SLUICE VALVE-RESILIENT-NON-RISING" || type === "SLUICE VALVE-RESILIENT-RISING") {
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 200) return 25;
    if (sizeNum !== null && sizeNum >= 250 && sizeNum <= 450) return 20;
    if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1000) return 30;
    return 30;
  }

  if (type === "SLUICE VALVE-METAL-NON-RISING" || type === "SLUICE VALVE-METAL-RISING") {
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) return 35;
    if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1200) return 40;
    return 30;
  }

  if (type === "TPAV" || type === "TPV") return 35;
  if (type === "PRESSURE RELIEF VALVE") return 200;
  if (type === "CHECK VALVE") return 200;
  if (type === "DPCV") return sizeNum !== null && sizeNum > 600 ? 35 : 20;
  if (type === "AIR CUSHION VALVE") return 75;
  if (type === "AIR VALVE") return 35;
  if (type === "ALTITUDE CONTROL VALVE") return 200;
  if (type === "BALL VALVE") return 50;
  if (type === "BUSH") return 100;
  if (type === "COMPANION FLANGE") return 15;
  if (type === "DISMANTLING JOINT") return 15;
  if (type === "EXPANSION BELOWS") return sizeNum !== null && sizeNum > 1000 ? 45 : 15;
  if (type === "FLOAT VALVE") return 15;
  if (type === "FOOT VALVE") return 20;
  if (type === "GASKET") return 40;

  if (type === "GATE VALVE") {
    if (sizeNum !== null && sizeNum >= 0 && sizeNum <= 450) return 35;
    if (sizeNum !== null && sizeNum >= 500 && sizeNum <= 1200) return 40;
    return 30;
  }

  if (type === "GEAR BOX") return 20;
  if (type === "GLOBE VALVE") return 40;
  if (type === "KNIFE GATE VALVE") return 20;
  if (type === "O-RING") return 40;
  if (type === "PLUG VALVE" || type === "PLUUG VALVE") return 100;
  if (type === "RETAINER RING") return 20;
  if (type === "RING") return 20;
  if (type === "SEAL RING") return 20;
  if (type === "SHAFT" || type === "SHHAFT") return 20;
  if (type === "SOLENOID VALVE") return 50;
  if (type === "SPINDLE") return 20;
  if (type === "WASHER") return 20;
  if (type === "ZERO VELOCITY VALVE") return 50;

  return null;
}
