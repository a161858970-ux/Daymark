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
      | "TOO_MANY_PAGES"
      | "TOO_MANY_SCANNED_PAGES"
      | "TOO_LARGE"
      | "NO_CONTENT"
      | "NO_COURSES",
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

interface PlacedText {
  str: string;
  x: number;
  y: number;
}

function placedItems(
  content: { items: unknown[] },
  mapPoint: (x: number, y: number) => [number, number],
): PlacedText[] {
  const placed: PlacedText[] = [];
  for (const raw of content.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { str?: unknown; transform?: unknown };
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const transform = Array.isArray(item.transform)
      ? (item.transform as number[])
      : [];
    const [x, y] = mapPoint(transform[4] ?? 0, transform[5] ?? 0);
    placed.push({ str: item.str.trim(), x, y });
  }
  return placed;
}

interface Column {
  min: number;
  max: number;
}

/**
 * Rebuild the table from item coordinates instead of joining every run of
 * text with a space.
 *
 * A timetable lays weekday columns side by side; flattening the stream keeps
 * the header (时间段 节次 星期一 …) but throws away which column each cell came
 * from, so the model cannot tell weekdays apart — and because `weekday` is
 * 1..7 and never null, it guessed and returned 1 for every meeting. Pages
 * may also be rotated (this one is rotate=90), so coordinates are mapped
 * through the page viewport first. Rows group by visual baseline, columns
 * are built from *overlapping* x ranges (a centred header label and the
 * left-aligned cell under it share one range, while a line that fills its
 * column never swallows its neighbour), and every row is padded to the full
 * width so a wrapped continuation line stays under its own column.
 */
export function layoutText(
  content: { items: unknown[] },
  mapPoint?: (x: number, y: number) => [number, number],
): string {
  const identity = (x: number, y: number): [number, number] => [x, y];
  const items = placedItems(content, mapPoint ?? identity);
  if (!items.length) return "";

  const rows: PlacedText[][] = [];
  // Viewport y grows downward: ascending y is top → bottom.
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of ordered) {
    const row = rows.at(-1);
    if (row && Math.abs((row[0] as PlacedText).y - item.y) <= ROW_GAP)
      row.push(item);
    else rows.push([item]);
  }

  const columns = buildColumns(rows);
  return rows.map((row) => placeRow(row, columns)).join("\n");
}

interface Edge {
  min: number;
  max: number;
  owners: Set<number>;
}

/**
 * Columns come from item left edges, in two groups.
 *
 * Recurring edges (hit from at least two rows) are the real grid: cells
 * repeat their left edge on every line they wrap onto. A page title spans
 * two weekday columns but appears once, so it can never weld them — that was
 * the bug in the overlap-based version. Once the grid exists, an edge that
 * sits *far* from every grid column (more than half a column pitch) is a
 * one-off that belongs to its own column: the header labels of empty
 * weekday columns (周末没有课) have no recurring cell under them, and
 * without this they collapsed into the last busy column.
 */
function buildColumns(rows: PlacedText[][]): Column[] {
  const edges: Edge[] = [];
  rows.forEach((row, rowIndex) => {
    for (const item of row) {
      const edge = edges.find(
        (candidate) =>
          item.x >= candidate.min - START_TOLERANCE &&
          item.x <= candidate.max + START_TOLERANCE,
      );
      if (edge) {
        edge.min = Math.min(edge.min, item.x);
        edge.max = Math.max(edge.max, item.x);
        edge.owners.add(rowIndex);
        continue;
      }
      edges.push({ min: item.x, max: item.x, owners: new Set([rowIndex]) });
    }
  });

  edges.sort((a, b) => a.min - b.min);
  const grid = edges.filter((edge) => edge.owners.size >= 2);
  // One recurring edge is just a document margin; without a second there is
  // no pitch to judge one-off edges against.
  if (grid.length < 2) return [];

  const pitch = medianGap(grid);
  const columns: Column[] = [...grid];
  for (const edge of edges) {
    if (edge.owners.size >= 2) continue;
    const nearest = Math.min(
      ...columns.map((column) => Math.abs(column.min - edge.min)),
    );
    if (nearest > pitch / 2) columns.push({ min: edge.min, max: edge.max });
  }
  if (columns.length < MIN_TABLE_COLUMNS) return [];
  return columns.sort((a, b) => a.min - b.min);
}

function medianGap(columns: Column[]): number {
  const gaps = columns
    .slice(1)
    .map((column, index) => column.min - (columns[index] as Column).min)
    .filter((gap) => gap > START_TOLERANCE)
    .sort((a, b) => a - b);
  if (!gaps.length) return Number.POSITIVE_INFINITY;
  return gaps[Math.floor(gaps.length / 2)] as number;
}

function placeRow(row: PlacedText[], columns: Column[]): string {
  const ordered = [...row].sort((a, b) => a.x - b.x);
  if (!columns.length) return ordered.map((item) => item.str).join(" ");

  const filled: string[] = [];
  for (const item of ordered) {
    let index = 0;
    let distance = Number.POSITIVE_INFINITY;
    columns.forEach((column, position) => {
      const gap = Math.abs(column.min - item.x);
      if (gap < distance) {
        distance = gap;
        index = position;
      }
    });
    while (filled.length < index) filled.push("");
    filled[index] = filled[index]
      ? `${filled[index]} ${item.str}`.replace(/\s+/g, " ")
      : item.str.replace(/\s+/g, " ");
  }
  return filled.join(" | ");
}

/** Baselines this close belong to one visual line. */
const ROW_GAP = 4;
/** Left edges this close are the same column; three of them mean a table. */
const START_TOLERANCE = 3;
const MIN_TABLE_COLUMNS = 3;

function pageText(
  content: { items: unknown[] },
  mapPoint?: (x: number, y: number) => [number, number],
): string {
  return layoutText(content, mapPoint).trim();
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
      // Coordinates are in PDF user space; a rotated page (rotate=90) puts
      // weekday columns on the y axis, which must be mapped to viewport
      // space before rows and columns mean anything.
      const viewport = page.getViewport({ scale: 1 });
      pageTexts.push({
        page: pageNumber,
        text: pageText(
          await page.getTextContent(),
          (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
        ),
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
