/**
 * Vendor the OCR runtime into public/ocr/.
 *
 * tesseract.js fetches its worker, its WebAssembly core and its language data from a CDN unless
 * told otherwise, and PDF.js does the same for its image decoders. A bank statement is the last
 * thing that should depend on a third-party host being up — or be uploaded anywhere at all — so
 * src/lib/statements/extract.js points every one of those paths at /ocr/ on the app's own origin,
 * and this script puts the files there from node_modules.
 *
 * Run it before `dev` and `build` (it is quick: files are only copied when missing or changed).
 * public/ocr/ is generated output, about 16 MB of binaries, and belongs in .gitignore.
 *
 *   node scripts/copy-ocr-assets.mjs
 *
 * What lands where, and why:
 *   worker.min.js                         tesseract.js's Web Worker (the `workerPath` option)
 *   tesseract-core-*-lstm.wasm.js         the engine, one build per SIMD capability; the worker
 *                                         picks one at runtime from `corePath`. The .wasm.js builds
 *                                         embed their binary, so no sibling .wasm is needed.
 *   eng.traineddata.gz                    English model, from `langPath`. It is not part of
 *                                         tesseract.js itself — install @tesseract.js-data/eng.
 *   pdfjs/*.wasm, pdfjs/*_nowasm_fallback.js, pdfjs/*.icc
 *                                         PDF.js decoders for JPEG 2000 / JBIG2 scans and CMYK
 *                                         colour (`wasmUrl` and `iccUrl`).
 *   pdfjs/standard_fonts/*                the fourteen standard fonts (`standardFontDataUrl`), which
 *                                         a text layer that does not embed its fonts is measured
 *                                         with; without them PDF.js warns and guesses widths.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'public', 'ocr');

// [source under node_modules, destination under public/ocr, package that provides it]
const FILES = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js', 'tesseract.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract.js-core'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract.js-core'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract.js-core',
  ],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz', '@tesseract.js-data/eng'],
  ['pdfjs-dist/wasm/openjpeg.wasm', 'pdfjs/openjpeg.wasm', 'pdfjs-dist'],
  ['pdfjs-dist/wasm/openjpeg_nowasm_fallback.js', 'pdfjs/openjpeg_nowasm_fallback.js', 'pdfjs-dist'],
  ['pdfjs-dist/wasm/jbig2.wasm', 'pdfjs/jbig2.wasm', 'pdfjs-dist'],
  ['pdfjs-dist/wasm/jbig2_nowasm_fallback.js', 'pdfjs/jbig2_nowasm_fallback.js', 'pdfjs-dist'],
  ['pdfjs-dist/wasm/qcms_bg.wasm', 'pdfjs/qcms_bg.wasm', 'pdfjs-dist'],
  ['pdfjs-dist/iccs/CGATS001Compat-v2-micro.icc', 'pdfjs/CGATS001Compat-v2-micro.icc', 'pdfjs-dist'],
  ...standardFonts(),
];

/** Every file in pdfjs-dist/standard_fonts, or nothing if the package is not installed yet. */
function standardFonts() {
  const dir = join(MODULES, 'pdfjs-dist', 'standard_fonts');
  if (!existsSync(dir)) return [['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts', 'pdfjs-dist']];
  return readdirSync(dir)
    .filter((f) => !/^LICENSE/i.test(f))
    .map((f) => [`pdfjs-dist/standard_fonts/${f}`, `pdfjs/standard_fonts/${f}`, 'pdfjs-dist']);
}

const missing = new Set();
let copied = 0;
let current = 0;

for (const [from, to, pkg] of FILES) {
  const src = join(MODULES, from);
  const dest = join(OUT, to);
  if (!existsSync(src)) {
    missing.add(pkg);
    continue;
  }
  const srcStat = statSync(src);
  if (existsSync(dest) && statSync(dest).size === srcStat.size) {
    current += 1;
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied += 1;
  console.log(`  copied ${to} (${(srcStat.size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`OCR assets: ${copied} copied, ${current} already current → public/ocr/`);

if (missing.size > 0) {
  console.error(
    `Missing packages, so the statement reader will not work offline: ${[...missing].join(', ')}\n` +
      `  npm install -D ${[...missing].join(' ')}`,
  );
  process.exit(1);
}
