import { z } from "zod";
import type { ImageAssetMap } from "../shared/types";

const imageDataUrlSchema = z.string().max(11_000_000).regex(
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/,
  "Invalid resolved image data"
);

const imageAssetMapSchema = z.record(z.string().url(), imageDataUrlSchema);

export function validateImageAssets(value: unknown): ImageAssetMap {
  return imageAssetMapSchema.parse(value);
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.src = "";
      reject(new Error("The replacement image timed out while loading on this page."));
    }, 8_000);
    image.addEventListener("load", () => {
      window.clearTimeout(timer);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve();
      else reject(new Error("The replacement image could not be decoded."));
    }, { once: true });
    image.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("This page blocked the replacement image. Try another image or a different page."));
    }, { once: true });
    image.src = src;
  });
}

export async function preloadImageAssets(imageAssets: ImageAssetMap): Promise<void> {
  await Promise.all([...new Set(Object.values(imageAssets))].map(preloadImage));
}
