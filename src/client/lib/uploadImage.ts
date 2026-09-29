/**
 * Getting a logo, banner or profile photo from a phone to the server.
 *
 * Phone photos are 3–8MB and 4000px across; a logo shown at 40px doesn't need
 * that, and on 4G it's the difference between a snappy upload and a spinner.
 * So the picture is shrunk in the browser first (the server shrinks again to
 * its own rules — this is only about the trip), then sent with progress.
 */

export type BrandKind = "logo" | "avatar" | "cover";

const LONGEST: Record<BrandKind, number> = { logo: 1024, avatar: 800, cover: 2400 };
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
const MAX_INPUT = 25 * 1024 * 1024;

export class UploadProblem extends Error {}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new UploadProblem("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall through to an <img>, which some browsers decode more of */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** A data URL ready to send, shrunk for its purpose. */
export async function prepareImage(file: File, kind: BrandKind): Promise<string> {
  const type = (file.type || "").toLowerCase();
  if (type && !ACCEPTED.includes(type)) {
    throw new UploadProblem("Use a JPG, PNG, WebP or GIF image.");
  }
  if (file.size > MAX_INPUT) throw new UploadProblem("That image is over 25MB — pick a smaller one.");

  // An animated GIF would lose its animation on a canvas.
  if (type === "image/gif") {
    if (file.size > 8 * 1024 * 1024) throw new UploadProblem("GIFs need to be under 8MB.");
    return readAsDataUrl(file);
  }

  let image: ImageBitmap | HTMLImageElement;
  try {
    image = await decode(file);
  } catch {
    throw new UploadProblem(
      type.includes("heic") || type.includes("heif")
        ? "This browser can't open iPhone HEIC photos. Pick a JPG or PNG, or take a screenshot of it."
        : "That file couldn't be opened as an image."
    );
  }

  const width = "naturalWidth" in image ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image ? image.naturalHeight : image.height;
  if (!width || !height) throw new UploadProblem("That image seems to be empty.");

  const scale = Math.min(1, LONGEST[kind] / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new UploadProblem("Couldn't process that image on this device.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ("close" in image) image.close();

  // Logos keep transparency; photos travel as JPEG.
  const keepAlpha = kind === "logo" && (type === "image/png" || type === "image/webp");
  const outType = keepAlpha ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
  if (!blob) throw new UploadProblem("Couldn't process that image on this device.");
  return readAsDataUrl(blob);
}

/** Send it. Resolves with where the server stored it. */
export function uploadBrandImage(
  kind: BrandKind,
  dataUrl: string,
  onProgress?: (fraction: number) => void
): Promise<{ id: string; url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/brand");
    xhr.setRequestHeader("content-type", "application/json");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: { id?: string; url?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON — handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id && body.url) {
        resolve({ id: body.id, url: body.url });
      } else if (xhr.status === 401) {
        reject(new UploadProblem("You've been signed out. Log in again to upload."));
      } else if (xhr.status === 413) {
        reject(new UploadProblem("That image is too big — try a smaller one."));
      } else {
        reject(new UploadProblem(body.error || "The upload didn't go through. Try again."));
      }
    };
    xhr.onerror = () => reject(new UploadProblem("No connection — check your signal and try again."));
    xhr.ontimeout = () => reject(new UploadProblem("The upload timed out. Try again."));
    xhr.timeout = 90_000;
    xhr.send(JSON.stringify({ kind, dataUrl }));
  });
}
