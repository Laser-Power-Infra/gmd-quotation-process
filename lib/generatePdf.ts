import fs from "fs";
import Handlebars from "handlebars";
import puppeteer, { PDFOptions } from "puppeteer";
import { OfferLetterTemplateData } from "@/types/offer-lettter";

/**
 * Register Handlebars helpers used by the offer letter template.
 * Safe to call multiple times; Handlebars just overwrites the helper.
 */
function registerHelpers(): void {
  // {{inc @index}} -> 1-based row number for the SL NO column
  Handlebars.registerHelper("inc", (index: number) => index + 1);
}

/**
 * Common install locations for a system Chrome/Chromium on Windows.
 * Used as a fallback when Puppeteer's bundled Chromium isn't available
 * (e.g. it was installed with PUPPETEER_SKIP_DOWNLOAD, or you want to
 * reuse an existing Chrome install instead of downloading another copy).
 */
const WINDOWS_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Chromium\\Application\\chrome.exe",
];

/**
 * Resolves which Chrome/Chromium executable to launch.
 * Priority: explicit override -> first existing Windows Chrome install -> undefined
 * (undefined tells Puppeteer to use its own bundled Chromium).
 */
function resolveChromePath(executablePathOverride?: string): string | undefined {
  if (executablePathOverride) return executablePathOverride;

  const found = WINDOWS_CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
  return found; // undefined if none of the candidates exist on this machine
}

export interface GeneratePdfOptions {
  /** Optional output path to write the PDF to, e.g. "./out/offer-GMD-060.pdf".
   *  If omitted, the PDF buffer is still returned but not persisted to disk. */
  outputPath?: string;

  /** Optional overrides passed straight through to Puppeteer's page.pdf(). */
  pdfOptions?: PDFOptions;

  /**
   * Optional explicit path to a Chromium/Chrome executable. Takes priority
   * over everything else. If omitted, generateOfferLetterPdf() will look
   * for a system Chrome install at the usual Windows locations before
   * falling back to Puppeteer's bundled Chromium.
   */
  executablePath?: string;
}

/**
 * Compiles a Handlebars template string with the given data, renders it in a
 * headless browser, and writes the result out as a PDF file.
 *
 * @param templateSource Raw Handlebars template string (e.g. contents of offer_letter.hbs)
 * @param data           Data to interpolate into the template
 * @param options        Output path + optional Puppeteer PDF settings
 * @returns              The PDF as a Buffer (also written to options.outputPath if provided)
 */
export async function generateOfferLetterPdf(
  templateSource: string,
  data: OfferLetterTemplateData,
  options: GeneratePdfOptions
): Promise<Buffer> {
  registerHelpers();

  // 1. Compile the Handlebars template with the dynamic data into a final HTML string.
  const template = Handlebars.compile<OfferLetterTemplateData>(templateSource);
  const html = template(data);

  // 2. Launch a headless browser and render that HTML.
  const chromePath = resolveChromePath(options.executablePath);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Note: page.setContent()'s WaitForOptions only supports "load" and
    // "domcontentloaded" (unlike page.goto(), it has no "networkidle0"/
    // "networkidle2"), since there's no network request to go idle on for
    // inline HTML. "load" waits for the load event, which covers inline
    // <style> and any same-origin images/fonts referenced in the markup.
    await page.setContent(html, { waitUntil: "load" });

    // Belt-and-suspenders: explicitly wait for web fonts (e.g. if you later
    // add a @font-face or Google Font link) to finish loading before printing,
    // since the "load" event doesn't guarantee font rendering is complete.
    await page.evaluateHandle("document.fonts.ready");

    // 3. Print the page to a PDF buffer.
    const defaultPdfOptions: PDFOptions = {
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    };

    const pdfBuffer = await page.pdf({
      ...defaultPdfOptions,
      ...options.pdfOptions,
      ...(options.outputPath ? { path: options.outputPath } : {}),
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}