// Dimensional details captured against a serial no. Plain TS (client + server safe).

export const DIMENSION_FIELDS = [
  ["size_dn", "Size (DN)"],
  ["pn_rating", "PN rating"],
  ["od", "OD (mm)"],
  ["id_mm", "ID (mm)"],
  ["pcd", "PCD (mm)"],
  ["bolt_holes", "No. of bolt holes"],
  ["hole_dia", "Hole dia (mm)"],
  ["flange_thickness", "Flange thickness (mm)"],
  ["face_to_face", "Face-to-face (mm)"],
  ["height_open", "Height open (mm)"],
  ["height_closed", "Height closed (mm)"],
  ["weight", "Weight (kg)"],
  ["flange_standard", "Flange standard / drilling"],
  ["body_moc", "Body MOC"],
  ["disc_moc", "Disc MOC"],
  ["seat_moc", "Seat MOC"],
  ["actuator", "Actuator / gearbox"],
] as const;

export type DimensionKey = (typeof DIMENSION_FIELDS)[number][0];
export type DimensionValues = Partial<Record<DimensionKey, string>>;
/** Allowed deviation per key; a missing side means the standard gives no tolerance. */
export type DimensionTolerances = Partial<Record<DimensionKey, { plus: number | null; minus: number | null }>>;
export type DimensionStandard = { values: DimensionValues; tolerances: DimensionTolerances };

/** Subset of the quotation Flange row used for pre-fill. */
export type FlangeStd = Partial<
  Record<
    | "size" | "moc" | "pnRatingClass" | "idMm" | "idTolerance" | "odMm" | "odTolerancePlus" | "odToleranceMinus"
    | "pcdMm" | "pcdTolerance" | "noOfHoleNos" | "holeDia" | "holeDiaTolerancePlus" | "holeDiaToleranceMinus"
    | "thicknessOfFlange" | "thicknessTolerancePlus" | "thicknessToleranceMinus" | "totalWeightKg" | "standards",
    string | null
  >
>;

const num = (v: unknown): number | null => {
  const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
// Tolerance cells may read "1.5", "±1.5" or "-1.5": the size of the number is what matters.
const tol = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.abs(n);
};

/** The Flange row for this stock row's size (Dia) and PN; MOC narrows when several rows match. */
export function pickFlange(
  rows: readonly FlangeStd[],
  r: { dimension?: string | null; l7_dimension?: string | null; l5_material?: string | null },
): FlangeStd | null {
  const hits = rows.filter(
    (f) => digits(f.size) !== "" && digits(f.size) === digits(r.dimension) && digits(f.pnRatingClass) === digits(r.l7_dimension),
  );
  const moc = String(r.l5_material ?? "").trim().toUpperCase();
  return (moc && hits.find((f) => String(f.moc ?? "").trim().toUpperCase() === moc)) || hits[0] || null;
}

/** Pre-fill from the Technicals > Flange standard. shortcut: CONSOLIDATED_VALVES is not in this repo, so face-to-face, heights and valve weight stay blank until it is wired in. */
export function standardFromFlange(f: FlangeStd): DimensionStandard {
  const sym = (v: unknown) => ({ plus: tol(v), minus: tol(v) });
  const pair = (p: unknown, m: unknown) => ({ plus: tol(p), minus: tol(m) });
  const values: DimensionValues = {};
  const set = (k: DimensionKey, v: string | null | undefined) => {
    if (String(v ?? "").trim()) values[k] = String(v).trim();
  };
  set("size_dn", f.size); set("pn_rating", f.pnRatingClass); set("od", f.odMm); set("id_mm", f.idMm);
  set("pcd", f.pcdMm); set("bolt_holes", f.noOfHoleNos); set("hole_dia", f.holeDia);
  set("flange_thickness", f.thicknessOfFlange); set("weight", f.totalWeightKg); set("flange_standard", f.standards);
  return {
    values,
    tolerances: {
      od: pair(f.odTolerancePlus, f.odToleranceMinus),
      id_mm: sym(f.idTolerance),
      pcd: sym(f.pcdTolerance),
      hole_dia: pair(f.holeDiaTolerancePlus, f.holeDiaToleranceMinus),
      flange_thickness: pair(f.thicknessTolerancePlus, f.thicknessToleranceMinus),
    },
  };
}

/** Keys whose measured value is outside standard +/- tolerance. Keys without a standard, a tolerance or a number are not flagged. */
export function outOfTolerance(values: DimensionValues, std: DimensionStandard): DimensionKey[] {
  const out: DimensionKey[] = [];
  for (const [k, t] of Object.entries(std.tolerances) as [DimensionKey, { plus: number | null; minus: number | null }][]) {
    const measured = num(values[k]);
    const nominal = num(std.values[k]);
    if (measured === null || nominal === null) continue;
    if ((t.plus !== null && measured > nominal + t.plus) || (t.minus !== null && measured < nominal - t.minus)) out.push(k);
  }
  return out;
}
