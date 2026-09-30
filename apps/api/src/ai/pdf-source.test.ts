import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  CourseImportParseError,
  DEFAULT_PDF_LIMITS,
  imageBatches,
  mergeCoursePreviews,
  preparePdfSource,
} from "./pdf-source.js";
import { importFailureMessage } from "../db/course-import.js";

async function fixture(name: string): Promise<string> {
  const path = fileURLToPath(
    new URL(`./__fixtures__/${name}`, import.meta.url),
  );
  return (await readFile(path)).toString("base64");
}

it("keeps text-based PDFs on the cheap text path", async () => {
  const prepared = await preparePdfSource(await fixture("text-timetable.pdf"));
  expect(prepared.pageCount).toBe(1);
  expect(prepared.images).toHaveLength(0);
  expect(prepared.text).toContain("Environmental Economics");
  expect(prepared.rasterizedPages).toBe(0);
});

it("decodes CJK CID fonts through the shipped CMaps", async () => {
  // Regression: without cMapUrl pdfjs cannot decode `UniGB-UCS2-H`, so a
  // Chinese timetable yields an empty text layer *and* blank rasterized
  // pages -> the model returns zero courses and the import fails.
  const prepared = await preparePdfSource(
    await fixture("uni-gb-cjk-timetable.pdf"),
  );
  expect(prepared.text).toContain("商业银行经营学");
  expect(prepared.rasterizedPages).toBe(0);
  expect(prepared.images).toHaveLength(0);
});

it("rasterizes a scanned PDF that has no usable text layer", async () => {
  const prepared = await preparePdfSource(
    await fixture("scanned-timetable.pdf"),
  );
  expect(prepared.text).toBeNull();
  expect(prepared.pageCount).toBe(2);
  expect(prepared.rasterizedPages).toBe(2);
  for (const image of prepared.images) {
    expect(image.mediaType).toBe("image/jpeg");
    const bytes = Buffer.from(image.base64, "base64");
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(bytes.length).toBeGreaterThan(1000);
  }
});

it("refuses oversized inputs with a product-facing message", async () => {
  const scanned = await fixture("scanned-timetable.pdf");

  await expect(
    preparePdfSource(scanned, { ...DEFAULT_PDF_LIMITS, maxPages: 1 }),
  ).rejects.toMatchObject({ kind: "TOO_MANY_PAGES" });

  await expect(
    preparePdfSource(scanned, { ...DEFAULT_PDF_LIMITS, maxRasterPages: 1 }),
  ).rejects.toMatchObject({ kind: "TOO_MANY_SCANNED_PAGES" });

  try {
    await preparePdfSource(scanned, {
      ...DEFAULT_PDF_LIMITS,
      maxImagePayloadBytes: 2048,
    });
    expect.unreachable("payload limit must reject the file");
  } catch (error) {
    expect(error).toBeInstanceOf(CourseImportParseError);
    const typed = error as CourseImportParseError;
    expect(typed.kind).toBe("TOO_LARGE");
    expect(typed.userMessage).toContain("过大");
    expect(typed.userMessage).not.toMatch(/base64|payload|byte/i);
  }
});

it("maps unreadable files to a readable message instead of internals", async () => {
  await expect(preparePdfSource("bm90IGEgcGRm")).rejects.toBeTruthy();
  try {
    await preparePdfSource("bm90IGEgcGRm");
  } catch (error) {
    const message = importFailureMessage(error);
    expect(message).toBe("无法可靠识别该课程表，请重新上传清晰文件。");
    expect(message).not.toMatch(/pdfjs|TypeError|undefined|stack/i);
  }
});

it("batches page images and merges batch results without duplicates", () => {
  const images = [1, 2, 3, 4, 5].map((page) => ({
    page,
    mediaType: "image/jpeg" as const,
    base64: "AAAA",
  }));
  expect(imageBatches(images, 4).map((batch) => batch.length)).toEqual([4, 1]);
  expect(imageBatches([], 4)).toEqual([]);

  const merged = mergeCoursePreviews([
    {
      courses: [
        { name: "环境经济学", instructor: null, schedules: [{ weekday: 3 }] },
        { name: "经济法", instructor: "林老师", schedules: [] },
      ],
    },
    {
      courses: [
        {
          name: "环境经济学",
          instructor: "王老师",
          schedules: [{ weekday: 5 }],
        },
        { name: "环境经济学", instructor: null, schedules: [{ weekday: 3 }] },
      ],
    },
  ]) as {
    courses: {
      name: string;
      instructor: string | null;
      schedules: unknown[];
    }[];
  };

  expect(merged.courses).toHaveLength(2);
  const economics = merged.courses.find(
    (course) => course.name === "环境经济学",
  )!;
  expect(economics.instructor).toBe("王老师");
  expect(economics.schedules).toHaveLength(2);
});
