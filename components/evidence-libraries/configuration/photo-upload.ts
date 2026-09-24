import { squareCrop } from "@/lib/evidence-libraries/configuration/home-people";

/** Photos people pick straight from a camera or a website. They are converted before upload, so any of these will do. */
export const PHOTO_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

/** Shown at most a few dozen pixels wide on the page, so this is plenty even on sharp screens. */
const PHOTO_SIZE = 480;

/** A person's photo as it is stored: a square WebP of at most 480 pixels, a few dozen kilobytes. */
export async function toPersonPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const { side, x, y } = squareCrop(bitmap.width, bitmap.height);
    const size = Math.min(PHOTO_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.drawImage(bitmap, x, y, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!blob || blob.type !== "image/webp") throw new Error("This browser cannot make a WebP");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`, { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
