import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface VisitorPhotoUpload { data: Buffer; mimetype: string }

export function validateVisitorPhoto(upload?: VisitorPhotoUpload) {
  if (!upload) return null;
  const { data, mimetype } = upload;
  const jpeg = data.length > 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (data.length > 2 * 1024 * 1024 || !((mimetype === 'image/jpeg' && jpeg) || (mimetype === 'image/png' && png))) {
    throw new BadRequestException('Attach a JPEG or PNG photo up to 2 MB.');
  }
  return { type: mimetype, hash: createHash('sha256').update(data).digest('hex') };
}
