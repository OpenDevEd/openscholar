// Shrinks an image attached to an assistant chat off the main thread, so the composer's
// animations keep their frames (./attachments.tsx). To the model's own ceiling, re-encoded,
// which also drops its location data: WebP where the browser encodes it, JPEG where it
// doesn't (Safari).
import { IMAGE_EDGE, IMAGE_PIXELS } from "@/lib/assistant/files";

self.onmessage = async (event: MessageEvent<{ id: string; file: Blob }>) => {
  const { id, file } = event.data;
  try {
    const source = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_EDGE / Math.max(source.width, source.height), Math.sqrt(IMAGE_PIXELS / (source.width * source.height)));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close();
    let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    self.postMessage({ id, blob });
  } catch {
    self.postMessage({ id });
  }
};
