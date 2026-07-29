import { NextResponse } from "next/server";
import { fetchGMDCategorySheet } from "@/lib/gmd_lib/google-sheets";

export async function GET() {
  try {
    const data = await fetchGMDCategorySheet();
    // Fetch live USD/INR rate
    try {
      // const res = await fetch(
      //   "https://api.frankfurter.app/latest?from=USD&to=INR",
      // );
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      const json = await res.json();
      const rate = json.rates?.INR;
      console.log(json.rates.INR);
      if (rate) {
        const base = Number(rate.toFixed(2)); // Keep 2 decimal places

        data["USD Rate Option"] = [
          (base - 0.5).toFixed(2),
          base.toFixed(2),
          (base + 0.5).toFixed(2),
        ];
      }
    } catch {
      // Fallback if API fails
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}
