import type { ImageAssetMap, WebModOperation } from "../shared/types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("The replacement image could not be downloaded. Try another image or provide a direct image URL.");
  }
  if (!response.ok) {
    throw new Error(`The replacement image server returned ${response.status}. Try another image or provide a direct image URL.`);
  }
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!type || !SAFE_IMAGE_TYPES.has(type)) {
    throw new Error("The selected web result is not a supported PNG, JPEG, WebP, or GIF image. Try another image.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("The replacement image is larger than 8 MB. Try a smaller image.");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(buffer.byteLength === 0
      ? "The replacement image download was empty. Try another image."
      : "The replacement image is larger than 8 MB. Try a smaller image.");
  }
  return `data:${type};base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

async function firstUsableImageUrl(urls: string[]): Promise<string> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fetchImageAsDataUrl(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No usable replacement image was found.");
}

export async function resolveImageAssets(
  operations: WebModOperation[],
  imageCandidates: string[] = []
): Promise<ImageAssetMap> {
  const urls = [...new Set(operations.flatMap((operation) =>
    operation.type === "replaceImage" || operation.type === "setBackgroundImage" ? [operation.src] : []
  ))];
  const safeCandidates = imageCandidates.filter((url) => {
    try {
      return ["https:", "http:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  });
  const entries = await Promise.all(urls.map(async (url) => [
    url,
    await firstUsableImageUrl([url, ...safeCandidates.filter((candidate) => candidate !== url)])
  ] as const));
  return Object.fromEntries(entries);
}
