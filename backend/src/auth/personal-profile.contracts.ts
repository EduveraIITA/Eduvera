import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export function normalizeContactPhone(value: string): string {
  const phone = value.trim().replace(/[\s().-]/gu, '');
  if (phone && !/^\+[1-9]\d{7,14}$/u.test(phone)) throw new BadRequestException('Enter a phone number with its country code, such as +91…, or leave it empty.');
  return phone;
}
export const personalProfileSchema = z.object({
  expected_revision: z.number().int().nonnegative(), client_request_id: z.string().uuid(),
  contact_phone: z.string().max(48),
  name: z.string().trim().max(301), expected_first_name: z.string().max(300), expected_last_name: z.string().max(300),
  education_background: z.string().trim().max(1000).refine(value => !/[\p{Cc}]/u.test(value.replace(/[\n\t]/gu, '')), 'Use ordinary text without control characters.'),
  photo_data_url: z.string().max(7 * 1024 * 1024).nullable().optional(),
}).strict();
export const phoneStartSchema = z.object({ expected_revision: z.number().int().nonnegative() }).strict();
export const phoneConfirmSchema = z.object({ challenge_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/u) }).strict();
/** Decode and re-encode: reject broken/oversized images and strip EXIF/location metadata. */
export async function sanitizedProfilePhoto(value: string): Promise<Buffer> {
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2]!.length % 4 !== 0) throw new BadRequestException('Choose a JPEG or PNG profile photo.');
  const bytes = Buffer.from(match[2]!, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== match[2]) throw new BadRequestException('Choose a photo under 5 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: 64_000_000, failOn: 'error' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png'].includes(metadata.format ?? '') || !metadata.width || !metadata.height) throw new Error('Unsupported image');
    const photo = await image.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    if (photo.length > 524288) throw new Error('Image is too large');
    return photo;
  } catch { throw new BadRequestException('The photo could not be read. Choose a valid JPEG or PNG image under 64 megapixels.'); }
}
