const thumbnailCache = new Map<string, string>();

/**
 * Generates or retrieves a low-res 140px thumbnail data URL for a given image URL.
 * This prevents the browser from decoding full-resolution 4K images in the sidebar,
 * eliminating sidebar scroll lag while preserving full quality for canvas previews.
 */
export function getThumbnailUrl(src: string, maxDim: number = 140): Promise<string> {
  if (thumbnailCache.has(src)) {
    return Promise.resolve(thumbnailCache.get(src)!);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        ctx.drawImage(img, 0, 0, w, h);
        const thumbUrl = canvas.toDataURL("image/jpeg", 0.7);
        thumbnailCache.set(src, thumbUrl);
        resolve(thumbUrl);
      } else {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}
