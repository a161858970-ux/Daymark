/**
 * PDF source preparation for course import.
 *
 * Text-based PDFs keep using page text (cheap, exact). Pages without a usable
 * text layer are rasterized to a controlled-size JPEG and sent through the
 * existing image input path, so scanned timetables still produce the same
 * structured preview.
 *
 * Hard limits keep a single request payload bounded: page count, rasterized
 * page count, per-page dimension, JPEG quality and total image payload.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export class CourseImportParseError extends Error {
  constructor(
    readonly kind:
      "TOO_MANY_PAGES" | "TOO_MANY_SCANNED_PAGES" | "TOO_LARGE" | "NO_CONTENT",
    readonly userMessage: string,
  ) {
    super(kind);
    this.name = "CourseImportParseError";
  }
}

export interface PdfPrepareLimits {
  /** Total pages accepted before the file is refused. */
  maxPages: number;
  /** A page at or above this many characters is treated as real text. */
  pageTextMinChars: number;
  /** Whole-document text below this is considered unusable. */
  minUsableTextChars: number;
  /** Pages without usable text that may be rasterized. */
  maxRasterPages: number;
  /** Longest edge of a rasterized page in CSS pixels. */
  maxPageDimension: number;
  jpegQuality: number;
  /** Total base64 payload budget for every rasterized page. */
  maxImagePayloadBytes: number;
}

export const DEFAULT_PDF_LIMITS: PdfPrepareLimits = {
  maxPages: 20,
  pageTextMinChars: 40,
  minUsableTextChars: 120,
  maxRasterPages: 8,
  maxPageDimension: 1600,
  jpegQuality: 72,
  maxImagePayloadBytes: 6 * 1024 * 1024,
};

/** Images per provider request; extra pages are sent in further batches. */
export const MAX_IMAGES_PER_REQUEST = 4;

export interface PreparedPageImage {
  page: number;
  mediaType: "image/jpeg";
  base64: string;
}

export interface PreparedPdfSource {
  pageCount: number;
  /** Page-marker text for every page that already had usable text. */
  text: string | null;
  images: PreparedPageImage[];
  rasterizedPages: number;
}

function pageText(content: { items: unknown[] }): string {
  return content.items
    .map((item) =>
      item && typeof item === "object" && "str" in item
        ? String((item as { str: unknown }).str)
        : "",
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function rasterizePage(
  page: {
    getViewport(options: { scale: number }): {
      width: number;
      height: number;
    };
    render(options: { canvasContext: unknown; viewport: unknown }): {
      promise: Promise<void>;
    };
  },
  limits: PdfPrepareLimits,
): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    limits.maxPageDimension / base.width,
    limits.maxPageDimension / base.height,
    3,
  );
  const width = Math.max(1, Math.ceil(base.width * scale));
  const height = Math.max(1, Math.ceil(base.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const viewport = page.getViewport({ scale });
  await page.render({
    canvasContext: context,
    viewport,
  }).promise;
  return canvas.toBuffer("image/jpeg", limits.jpegQuality);
}

/**
 * pdfjs needs the shipped CMap / standard-font data to decode (and to render)
 * CJK CID fonts such as `UniGB-UCS2-H`. Without it a Chinese timetable PDF
 * yields an empty text layer *and* blank rasterized pages, so the import ends
 * up with zero courses. Resolve both directories from the installed package.
 */
export function pdfAssetDirs(): {
  cMapUrl: string;
  standardFontDataUrl: string;
} {
  const entry = fileURLToPath(
    import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
  );
  // <pkg>/legacy/build/pdf.mjs -> <pkg>
  const root = dirname(dirname(dirname(entry)));
  // pdfjs validates a *URL-style* trailing slash, so keep forward slashes
  // even on Windows (fs.readFile accepts them).
  const dir = (name: string) => `${join(root, name).replaceAll("\\", "/")}/`;
  return {
    cMapUrl: dir("cmaps"),
    standardFontDataUrl: dir("standard_fonts"),
  };
}

/**
 * Never throws for unreadable content: an unusable file becomes a typed
 * error with a product-facing message, so the import job can stay recoverable.
 */
export async function preparePdfSource(
  contentBase64: string,
  limits: PdfPrepareLimits = DEFAULT_PDF_LIMITS,
): Promise<PreparedPdfSource> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = Uint8Array.from(Buffer.from(contentBase64, "base64"));
  const assets = pdfAssetDirs();
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: assets.standardFontDataUrl,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > limits.maxPages)
      throw new CourseImportParseError(
        "TOO_MANY_PAGES",
        `课程表文件页数过多（${document.numPages} 页，最多 ${limits.maxPages} 页），请拆分后分次导入。`,
      );

    const pageTexts: { page: number; text: string }[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      pageTexts.push({
        page: pageNumber,
        text: pageText(await page.getTextContent()),
      });
      page.cleanup();
    }

    // Thin text layers (headers, page numbers) are not trusted: every page is
    // rasterized instead, which is what a scanned timetable looks like.
    const usableTextChars = pageTexts.reduce(
      (total, entry) => total + entry.text.length,
      0,
    );
    const textTrusted = usableTextChars >= limits.minUsableTextChars;
    const textPages = textTrusted
      ? pageTexts.filter(
          (entry) => entry.text.length >= limits.pageTextMinChars,
        )
      : [];
    const rasterTargets = (
      textTrusted
        ? pageTexts.filter(
            (entry) => entry.text.length < limits.pageTextMinChars,
          )
        : pageTexts
    ).map((entry) => entry.page);
    const textParts = textPages.map(
      (entry) => `Page ${entry.page}: ${entry.text}`,
    );

    if (!textParts.length && !rasterTargets.length)
      throw new CourseImportParseError(
        "NO_CONTENT",
        "无法可靠识别该课程表，请重新上传清晰文件。",
      );
    if (rasterTargets.length > limits.maxRasterPages)
      throw new CourseImportParseError(
        "TOO_MANY_SCANNED_PAGES",
        `扫描页过多（${rasterTargets.length} 页，最多 ${limits.maxRasterPages} 页），请拆分后分次导入。`,
      );

    const images: PreparedPageImage[] = [];
    let payloadBytes = 0;
    for (const pageNumber of rasterTargets) {
      const page = await document.getPage(pageNumber);
      const jpeg = await rasterizePage(page as never, limits);
      page.cleanup();
      payloadBytes += Math.ceil((jpeg.length * 4) / 3);
      if (payloadBytes > limits.maxImagePayloadBytes)
        throw new CourseImportParseError(
          "TOO_LARGE",
          "课程表文件图像内容过大，无法安全解析，请压缩后重试。",
        );
      images.push({
        page: pageNumber,
        mediaType: "image/jpeg",
        base64: jpeg.toString("base64"),
      });
    }

    if (!textParts.length && !images.length)
      throw new CourseImportParseError(
        "NO_CONTENT",
        "无法可靠识别该课程表，请重新上传清晰文件。",
      );

    return {
      pageCount: document.numPages,
      text: textParts.length ? textParts.join("\n") : null,
      images,
      rasterizedPages: images.length,
    };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

/** Batches prepared page images so one request stays within payload limits. */
export function imageBatches(
  images: PreparedPageImage[],
  perRequest = MAX_IMAGES_PER_REQUEST,
): PreparedPageImage[][] {
  const batches: PreparedPageImage[][] = [];
  for (let index = 0; index < images.length; index += perRequest)
    batches.push(images.slice(index, index + perRequest));
  return batches;
}

interface CoursePreview {
  courses: {
    name: string;
    instructor: string | null;
    schedules: Record<string, unknown>[];
  }[];
}

/** Merges batch responses without duplicating a course name. */
export function mergeCoursePreviews(results: unknown[]): unknown {
  const courses = new Map<string, CoursePreview["courses"][number]>();
  for (const result of results) {
    const parsed = result as CoursePreview | null;
    if (!parsed || !Array.isArray(parsed.courses)) continue;
    for (const course of parsed.courses) {
      const existing = courses.get(course.name);
      if (!existing) {
        courses.set(course.name, {
          ...course,
          schedules: [...course.schedules],
        });
        continue;
      }
      existing.instructor = existing.instructor ?? course.instructor;
      for (const schedule of course.schedules) {
        const signature = JSON.stringify(schedule);
        if (
          !existing.schedules.some(
            (value) => JSON.stringify(value) === signature,
          )
        )
          existing.schedules.push(schedule);
      }
    }
  }
  return { courses: [...courses.values()] };
}
