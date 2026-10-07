// Shrinks an attached image off the main thread, so the composer's animations keep their frames:
// to the model's own ceiling (Claude scales anything larger down anyway), re-encoded, which also
// drops its location data. WebP where the browser can encode it, JPEG where it can't (Safari).

const EDGE = 1568;
const PIXELS = 1_150_000;

self.onmessage = async (event: MessageEvent<{ id: string; file: Blob }>) => {
  const { id, file } = event.data;
  try {
    const source = await createImageBitmap(file);
    const scale = Math.min(1, EDGE / Math.max(source.width, source.height), Math.sqrt(PIXELS / (source.width * source.height)));
    const canvas = new OffscreenCanvas(Math.round(source.width * scale), Math.round(source.height * scale));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close();
    let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    self.postMessage({ id, blob });
  } catch {
    self.postMessage({ id, error: true });
  }
};
