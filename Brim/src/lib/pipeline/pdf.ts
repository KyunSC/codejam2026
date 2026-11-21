/**
 * PDF.js, loaded on first use from the legacy build (the one meant for Node).
 *
 * pdfjs-dist 6 calls `Promise.withResolvers`, which Node only has from 22. The project still
 * runs on Node 20.19+ (package.json engines), so it is polyfilled here before PDF.js loads.
 * The polyfill follows the spec and does nothing where the method already exists.
 */
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loaded: Promise<PdfJs> | null = null;

function polyfillWithResolvers(): void {
  const P = Promise as PromiseConstructor & { withResolvers?: unknown };
  if (typeof P.withResolvers === "function") return;
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

export function pdfjs(): Promise<PdfJs> {
  if (!loaded) {
    polyfillWithResolvers();
    loaded = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return loaded;
}

export interface PdfRead {
  pageCount: number;
  /** Text per page, items joined with spaces. */
  pages: string[];
}

/** Opens a PDF and reads its text layer. Throws PDF.js's own errors (named exceptions). */
export async function readPdf(bytes: Uint8Array): Promise<PdfRead> {
  const lib = await pdfjs();
  // PDF.js refuses a Node Buffer and transfers (detaches) what it is given, so hand it a
  // plain Uint8Array copy.
  const task = lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await task.destroy();
  }
}
