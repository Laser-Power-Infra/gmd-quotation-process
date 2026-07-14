import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { allowedSizes } from './sizeExtractor'

const VALIDATION_ENABLED = process.env.AI_VALIDATION_ENABLED !== 'false'
const OPENAI_KEY = process.env.OPENAI_API_KEY

const ALLOWED_MOCS = [
  "DUCTILE IRON/CAST IRON",
  "MILD STEEL",
  "CAST STEEL/CARBON STEEL",
  "ACTUATOR",
  "RUBBER",
  "OTHERS",
  "CAPEX",
  "STAINLESS STEEL",
  "GUN METAL/ BRASS",
  "LEATHER",
  "FORGED STEEL",
  "MONEL STEEL",
  "WOODEN",
  "GALVANISED",
] as const

const NOT_FOUND = "Not detectable"

const validationSchema = z.object({
  itemType: z.object({
    category: z.string().describe('The correct item type category'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the classification'),
  }),
  moc: z.object({
    material: z.enum(ALLOWED_MOCS).describe('The correct material of construction from the allowed list'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the MOC classification'),
  }),
  size: z.object({
    value: z.string().describe(`The correct size in mm, must be one of: ${allowedSizes.join(", ")}. If no size can be determined, use "${NOT_FOUND}".`),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the size detection'),
  }),
})

export interface AiValidationResult {
  itemType: { category: string | null; confidence: string }
  moc: { material: string | null; confidence: string }
  size: { value: string | null; confidence: string } | null
}

export async function validateItem(
  itemName: string,
  keywordItemType?: string | null,
  keywordMoc?: string | null,
  keywordSize?: string | null
): Promise<AiValidationResult | null> {
  if (!VALIDATION_ENABLED || !OPENAI_KEY) return null
  if (!itemName || typeof itemName !== 'string' || !itemName.trim()) return null

  try {
    const kwType = (keywordItemType || 'unknown').trim()
    const kwMoc = (keywordMoc || 'unknown').trim()
    const kwSize = (keywordSize || 'unknown').trim()

    const result = await generateText({
      model: openai('gpt-4o-mini'),
      output: Output.object({ schema: validationSchema }),
      system: `
You are an expert quotation and tender item classifier for industrial valves, pipes, and fittings.

Your task is to determine the correct ITEM TYPE, MOC (Material of Construction), and SIZE from the item name.

Rules for ITEM TYPE:
- Determine the ITEM TYPE from the item name, even when abbreviations, compressed text, or missing spaces are used.
- Common abbreviations: NRV=Non Return Valve, BFV=Butterfly Valve, BV=Ball Valve, GV=Gate Valve, SV=Sluice Valve, GLV=Globe Valve, CV=Check Valve, PRV=Pressure Relief Valve
- Do NOT confuse different valve types. Gate Valve ≠ Sluice Valve, Ball Valve ≠ Butterfly Valve, etc.
- Ignore spaces, hyphens, slashes, brackets, punctuation and casing.

Rules for MOC:
- Detect MOC whenever possible from material abbreviations.
- CI=Cast Iron, DI=Ductile Iron, CS/Carbon Steel, SS/SS304/SS316=Stainless Steel, WCB=Cast Steel, Bronze, Brass, PVC, HDPE, etc.
- If the item name does not specify material, return "unknown".

Rules for SIZE:
- Extract the size in mm from the item name even without explicit units.
- "DN150" or "150DN" → "150"
- "150 NB" or "150 NB" → "150"
- Bare "150" in "Valve 150 PN16" → "150" (use domain knowledge to distinguish size vs pressure rating)
- "6 inch" or '6"' → "150" (convert to mm)
- The size must be one of the allowed sizes.
- If no size can be determined, use "Not mentioned/cant detect size".

If the keyword-detected values are already correct, keep them unchanged.
If they are wrong, correct them based solely on the item name.
Return ONLY JSON.
`,
      prompt: `
Item Name:
"${itemName.trim()}"

Keyword-detected Item Type:
"${kwType}"

Keyword-detected MOC:
"${kwMoc}"

Keyword-detected Size:
"${kwSize}"
`,
      temperature: 0,
    })

    const output = result.output

    return {
      itemType: {
        category: output.itemType?.category?.trim() || null,
        confidence: output.itemType?.confidence || 'low',
      },
      moc: {
        material: output.moc?.material?.trim() || null,
        confidence: output.moc?.confidence || 'low',
      },
      size: output.size
        ? {
            value: output.size.value?.trim() || null,
            confidence: output.size.confidence || 'low',
          }
        : null,
    }
  } catch (err) {
    console.warn(`[AIValidator] Validation failed for "${itemName}": ${(err as Error).message}`)
    return null
  }
}
