import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveImageAssets } from "../src/background/imageAssets";
import { preloadImageAssets, validateImageAssets } from "../src/content/imageAssets";

function response(type: string, bytes = new Uint8Array([137, 80, 78, 71])): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": type, "content-length": String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.buffer
  } as Response;
}

describe("resolved image assets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls through to another grounded candidate and returns validated local image data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("text/html"))
      .mockResolvedValueOnce(response("image/png"));
    vi.stubGlobal("fetch", fetchMock);

    const primary = "https://example.com/not-an-image";
    const fallback = "https://cdn.example.com/orange.png";
    const assets = await resolveImageAssets(
      [{ type: "replaceImage", elementId: "wm_1", src: primary }],
      [primary, fallback]
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assets[primary]).toMatch(/^data:image\/png;base64,/);
    expect(validateImageAssets(assets)).toEqual(assets);
  });

  it("rejects executable or malformed resolved image data", () => {
    expect(() => validateImageAssets({
      "https://example.com/image.png": "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=="
    })).toThrow("Invalid resolved image data");
  });

  it("confirms that the page can decode a resolved image before applying it", async () => {
    class LoadableImage extends EventTarget {
      naturalWidth = 64;
      naturalHeight = 64;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    vi.stubGlobal("Image", LoadableImage);

    await expect(preloadImageAssets({
      "https://example.com/orange.png": "data:image/png;base64,aGVsbG8="
    })).resolves.toBeUndefined();
  });

  it("rejects an image blocked by the page before applying a transaction", async () => {
    class BlockedImage extends EventTarget {
      naturalWidth = 0;
      naturalHeight = 0;

      set src(_value: string) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      }
    }
    vi.stubGlobal("Image", BlockedImage);

    await expect(preloadImageAssets({
      "https://example.com/orange.png": "data:image/png;base64,aGVsbG8="
    })).rejects.toThrow("page blocked");
  });
});
