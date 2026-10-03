import sharp from "sharp";

/**
 * Photos come in at whatever the phone took them at, and the database keeps
 * every byte of it forever.
 *
 * Nothing in this app ever deleted or shrank an image, so the MySQL volume
 * only grew — it reached 75% of its capacity and had to be resized, which
 * buys time and fixes nothing. An 8MB photo straight off a phone is around
 * 4000 pixels on its long side. The two things this app does with a picture
 * are show it in a thread on Brad's phone and hand its URL to Facebook to
 * collect when a post is published. Neither needs 4000 pixels: the dashboard
 * shows it a few hundred wide, and Facebook re-encodes and downsizes anything
 * it is given anyway — its own photo endpoint refuses uploads over 4MB, so an
 * 8MB original was never publishable in the first place.
 *
 * So the bytes are re-encoded on the way in. The rules below are all about
 * not making anything worse:
 *
 *  - the aspect ratio never changes (`fit: "inside"`), and nothing is ever
 *    enlarged;
 *  - a photo that is already small is left exactly as it arrived, byte for
 *    byte — re-encoding a 60KB thumbnail only costs quality;
 *  - if the re-encode comes out no smaller than the original, the original
 *    is kept. That is the whole point, and it is also what protects the odd
 *    file where the guesses here are wrong;
 *  - anything sharp can't read, or that has more than one frame (an animated
 *    GIF or WebP — a re-encode would drop the animation), is passed straight
 *    through untouched.
 *
 * A failure here must never cost the photo. Every path falls back to the
 * bytes that came in.
 */

export interface ShrinkProfile {
  /** Longest side, in pixels. The shorter side follows the aspect ratio. */
  maxDimension: number;
  /** JPEG/WebP quality, 1-100. */
  quality: number;
}

/**
 * A customer's reference photo. It is looked at in a thread, on a phone, and
 * quoted back in a reply — 1600px is more than that ever needs.
 */
export const INBOX_PHOTO: ShrinkProfile = { maxDimension: 1600, quality: 80 };

/**
 * The studio's own work, off the QR code on the wall or picked for a post.
 * These get published to the Page, so they keep more room than an enquiry
 * photo: 2048 is what Facebook itself recommends uploading.
 */
export const STUDIO_PHOTO: ShrinkProfile = { maxDimension: 2048, quality: 85 };

/**
 * Under this, and already within the size limit, a photo is left alone. A
 * small image is usually already compressed to death, or a logo, or a
 * screenshot of a price — re-encoding it saves nothing worth having.
 */
const LEAVE_ALONE_BYTES = 150 * 1024;

export interface Shrunk {
  bytes: Buffer;
  contentType: string;
  /** True when these are the bytes that came in, untouched. */
  original: boolean;
  /** One short sentence for a log line. */
  detail: string;
}

function normalise(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

export function readableSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Re-encode one photo for storage. Returns the bytes to keep and the content
 * type that describes them — which may not be the one that came in, because
 * a PNG photograph with no transparency is stored as a JPEG.
 */
export async function shrinkPhoto(
  bytes: Buffer,
  contentType: string,
  profile: ShrinkProfile = INBOX_PHOTO
): Promise<Shrunk> {
  const type = normalise(contentType);
  const keep = (detail: string): Shrunk => ({
    bytes,
    contentType: type,
    original: true,
    detail,
  });

  // A GIF is nearly always animated here, and a still frame is not the same
  // message. Not worth the byte.
  if (type === "image/gif") return keep("left a GIF alone");

  try {
    const meta = await sharp(bytes).metadata();
    // EXIF orientations 5-8 mean the file is stored on its side: a portrait
    // phone photo reports 4032x3024. Swapping them here keeps the log honest
    // — otherwise it reads "4032x3024 → 1200x1600" and looks like the aspect
    // ratio was thrown away, when nothing of the kind happened.
    const sideways = (meta.orientation ?? 1) >= 5;
    const width = (sideways ? meta.height : meta.width) ?? 0;
    const height = (sideways ? meta.width : meta.height) ?? 0;
    if (!width || !height) return keep("couldn't read the size, kept as it arrived");

    // Animated WebP and the like. One frame out is worse than the bytes.
    if ((meta.pages ?? 1) > 1) return keep("left an animation alone");

    const longest = Math.max(width, height);
    if (bytes.length <= LEAVE_ALONE_BYTES && longest <= profile.maxDimension) {
      return keep(`already small (${readableSize(bytes.length)}, ${width}x${height})`);
    }

    // .rotate() with no argument bakes in the EXIF orientation flag before
    // sharp drops the metadata — without it, portrait photos off an iPhone
    // come back on their side, which is a worse bug than the one being fixed.
    let pipeline = sharp(bytes).rotate();
    if (longest > profile.maxDimension) {
      pipeline = pipeline.resize({
        width: profile.maxDimension,
        height: profile.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Transparency has to survive, so anything with an alpha channel stays a
    // PNG. Everything else — photographs, and the screenshots people send of
    // someone else's tattoo — becomes a JPEG, which is where the saving is.
    const transparent = meta.hasAlpha === true;
    const out = transparent
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: profile.quality, progressive: true, mozjpeg: true }).toBuffer();

    if (out.length >= bytes.length) {
      return keep(`re-encoding gained nothing (${readableSize(bytes.length)})`);
    }

    const outMeta = await sharp(out).metadata();
    return {
      bytes: out,
      contentType: transparent ? "image/png" : "image/jpeg",
      original: false,
      detail:
        `${readableSize(bytes.length)} → ${readableSize(out.length)} ` +
        `(${width}x${height} → ${outMeta.width}x${outMeta.height})`,
    };
  } catch (error) {
    // HEIC off an iPhone is the likely one — libvips will not always decode
    // it. Keeping the original is exactly what happened before this existed.
    return keep(`kept as it arrived — ${(error as Error).message}`);
  }
}
