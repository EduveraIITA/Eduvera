import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeContactPhone, personalProfileSchema, sanitizedProfilePhoto } from '../src/auth/personal-profile.contracts.js';
import { AccountPhoneDelivery } from '../src/auth/account-phone-delivery.js';

describe('personal profile boundaries',()=>{
 it('requires an explicit international phone and preserves blank optional contact',()=>{
  expect(normalizeContactPhone(' +91 98765-43210 ')).toBe('+919876543210');expect(normalizeContactPhone('')).toBe('');
  for(const phone of ['9876543210','+0123456789','+91abc123456789','tel:+919876543210'])expect(()=>normalizeContactPhone(phone)).toThrow();
 });
 it('keeps personal background bounded and rejects role/verification injection',()=>{
  const base={name:'Mira',expected_first_name:'Mira',expected_last_name:'',expected_revision:0,client_request_id:'11111111-1111-4111-8111-111111111111',contact_phone:'',education_background:'MSc\nComputer science'};
  expect(personalProfileSchema.parse(base)).toEqual(base);
  for(const extra of [{role:'admin'},{phone_verified:true},{school_id:'other'},{education_background:'a'.repeat(1001)},{education_background:'bad\x00text'}])expect(()=>personalProfileSchema.parse({...base,...extra})).toThrow();
 });
 it('decodes, resizes and removes EXIF from the saved photo instead of trusting its data prefix',async()=>{
  const bytes=await sharp({create:{width:1200,height:900,channels:3,background:'#79a9a0'}}).jpeg().withExif({IFD0:{Artist:'Private synthetic test'}}).toBuffer();
  expect((await sharp(bytes).metadata()).exif).toBeTruthy();
  const saved=await sanitizedProfilePhoto('data:image/jpeg;base64,'+bytes.toString('base64')),meta=await sharp(saved).metadata();
  expect(meta.format).toBe('jpeg');expect(meta.width).toBe(512);expect(meta.height).toBe(512);expect(meta.exif).toBeUndefined();expect(saved.length).toBeLessThan(524288);
 });
 it('rejects corrupted, remote and executable image forms without issuing a request',async()=>{
  for(const input of ['https://other.invalid/image.jpg','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,YmFk'])await expect(sanitizedProfilePhoto(input)).rejects.toThrow();
 });
 it('the disconnected SMS adapter never emits or returns an OTP',async()=>{
  const delivery=new AccountPhoneDelivery();expect(delivery.configured()).toBe(false);
  await expect(delivery.send({phone:'+15555550101',code:'123456',expiresAt:new Date(),challengeId:'test'})).rejects.toThrow(/not connected/);
 });
});
