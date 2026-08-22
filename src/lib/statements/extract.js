/**
 * From an uploaded PDF to lines of text, in the browser.
 *
 * Two very different documents arrive through the same input. FNB's overview has a text layer, and
 * PDF.js hands it back as positioned fragments that have to be stitched into lines again. Nedbank's
 * is a picture of a table, and the only way to read it is to draw each page to a canvas and run
 * OCR over the pixels. The decision is made per page by counting what the text layer gave: fewer
 * than a sentence's worth of characters means a scan.
 *
 * Both libraries are loaded on demand. Together they are several megabytes of code and the OCR
 * runtime is another fifteen of WebAssembly and training data, none of which belongs in the
 * app's start-up path for a feature used once a month. The OCR assets are served from /ocr/ —
 * see scripts/copy-ocr-assets.mjs — so the statement never leaves the device and the feature
 * works without a CDN.
 *
 * Progress is reported as `{ stage: 'text' | 'ocr', status, progress }`; OCR's own messages pass
 * through with their 0–1 `progress`.
 */

const TEXT_MIN_CHARS = 20;
// Measured on a real scan: at scale 2 the thousands separators and the odd word go missing, at
// scale 3 they survive, and beyond that nothing improves while the canvas gets heavy.
const OCR_SCALE = 3;
const ASSETS = '/ocr/';

/**
 * Rebuild lines from PDF.js text items.
 *
 * Items on the same baseline (within `yTolerance` units) are one line, read left to right. Adjacent
 * items are joined with NO space — that is what a naive extractor gives and what FNB's run-together
 * rows look like — unless the gap between them is wider than a character and a half, which is a
 * real column boundary and gets a space. Y runs upward in PDF space, so higher y is earlier.
 */
export function linesFromTextItems(items, { yTolerance = 2, gapFactor = 1.5 } = {}) {
  const glyphs = (items ?? [])
    .filter((i) => typeof i?.str === 'string' && i.str.length > 0 && Array.isArray(i.transform))
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width ?? 0 }));
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const g of glyphs) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - g.y) <= yTolerance) row.items.push(g);
    else rows.push({ y: g.y, items: [g] });
  }

  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prev = null;
      for (const item of row.items) {
        if (prev) {
          const gap = item.x - (prev.x + prev.width);
          const widths = [prev, item]
            .filter((i) => i.width > 0 && i.str.trim().length > 0)
            .map((i) => i.width / i.str.length);
          const charWidth = widths.length ? widths.reduce((s, w) => s + w, 0) / widths.length : 0;
          if (charWidth > 0 ? gap > gapFactor * charWidth : gap > 1) text += ' ';
        }
        text += item.str;
        prev = item;
      }
      return text.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function ink(lines) {
  return lines.reduce((n, l) => n + l.replace(/\s+/g, '').length, 0);
}

function makeCanvas(width, height) {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

async function rasterise(page) {
  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = canvas.getContext('2d');
  await page.render({ canvas, canvasContext, viewport }).promise;
  return canvas;
}

async function recognisePages(pages, report) {
  const mod = await import('tesseract.js');
  // The package is CommonJS; depending on how the bundler wrapped it the API is either the
  // namespace itself or its default export.
  const tesseract = typeof mod.createWorker === 'function' ? mod : mod.default;
  const worker = await tesseract.createWorker('eng', 1, {
    workerPath: `${ASSETS}worker.min.js`,
    corePath: ASSETS,
    langPath: ASSETS,
    logger: (m) => report('ocr', { status: m.status, progress: m.progress }),
  });
  try {
    // A balances page is one table. Left to its own layout analysis Tesseract will happily split
    // it into columns and read them one after another, which puts every balance on a different
    // line from its account. A single block keeps each printed row as one line of text.
    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM?.SINGLE_BLOCK ?? '6',
      preserve_interword_spaces: '1',
    });
    const out = [];
    for (const page of pages) {
      const canvas = await rasterise(page);
      const { data } = await worker.recognize(canvas);
      out.push(
        String(data?.text ?? '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
      );
    }
    return out;
  } finally {
    await worker.terminate();
  }
}

/**
 * @param {File} file            the uploaded PDF
 * @param {object} options       `onProgress(message)` for the UI
 * @returns {Promise<{ lines: string[], method: 'text' | 'ocr', pages: number }>}
 */
export default async function extractLines(file, { onProgress } = {}) {
  const report = (stage, detail = {}) => onProgress?.({ stage, ...detail });
  report('text', { status: 'Opening the PDF' });

  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }
  const task = pdfjs.getDocument({
    data,
    // Scans come in every image codec; the decoders PDF.js needs for JPEG 2000 and JBIG2 live next
    // to the OCR assets, as do the standard fonts a text layer without embedded fonts is measured
    // with — and measurement is what decides where a space goes between two cells.
    wasmUrl: `${ASSETS}pdfjs/`,
    iccUrl: `${ASSETS}pdfjs/`,
    standardFontDataUrl: `${ASSETS}pdfjs/standard_fonts/`,
    isEvalSupported: false,
  });
  const doc = await task.promise;

  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      report('text', { status: `Reading page ${n} of ${doc.numPages}`, page: n, pages: doc.numPages });
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines = linesFromTextItems(content.items);
      pages.push(ink(lines) >= TEXT_MIN_CHARS ? { lines } : { page });
    }

    const scans = pages.filter((p) => p.page);
    if (scans.length > 0) {
      const recognised = await recognisePages(
        scans.map((p) => p.page),
        report,
      );
      scans.forEach((p, i) => {
        p.lines = recognised[i];
      });
    }

    return {
      lines: pages.flatMap((p) => p.lines ?? []),
      method: scans.length > 0 ? 'ocr' : 'text',
      pages: doc.numPages,
    };
  } finally {
    // The document proxy has no destroy of its own in PDF.js 6; the loading task owns the worker.
    await task.destroy();
  }
}
