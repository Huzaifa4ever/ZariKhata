/**
 * Turn a picked file into a small square-ish JPEG data URL.
 *
 * Product photos come straight off a phone - 3–8MB is normal - and they get
 * stored in the product row, which is backed up with the database. Downsizing
 * on the client keeps a thousand products in the low tens of megabytes instead
 * of several gigabytes, and means the backend never has to handle a big upload.
 */
const MAX_EDGE = 640;
const QUALITY = 0.82;

export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process that image.');

    // JPEG has no alpha, so flatten onto white rather than letting transparent
    // PNG corners come out black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', QUALITY);
  } finally {
    bitmap.close();
  }
}
