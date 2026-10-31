import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { MAX_SCENE_IMAGE_BYTES } from "./campus-scenes.contracts.js";

/** Decode only bounded raster source images. SVG/HTML and remote fetching are not supported. */
export function decodeSceneImage(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  if (!match)
    throw new BadRequestException("Upload a PNG, JPEG or WebP source image.");
  const mime = match[1] as "image/png" | "image/jpeg" | "image/webp",
    encoded = match[2]!;
  const bytes = Buffer.from(encoded, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_SCENE_IMAGE_BYTES ||
    bytes.toString("base64") !== encoded
  )
    throw new BadRequestException(
      "Upload a valid source image no larger than 4 MiB.",
    );
  let width = 0,
    height = 0;
  if (
    mime === "image/png" &&
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (
    mime === "image/jpeg" &&
    bytes.length >= 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
      height =
        1 +
        ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0xf) << 10));
    } else if (
      kind === "VP8 " &&
      bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  }
  if (
    !width ||
    !height ||
    width > 30_000 ||
    height > 30_000 ||
    width * height > 100_000_000
  )
    throw new BadRequestException(
      "The source image signature or dimensions are unsupported. Use a PNG, JPEG or WebP below 100 megapixels.",
    );
  return {
    bytes,
    mime_type: mime,
    width,
    height,
    byte_size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
