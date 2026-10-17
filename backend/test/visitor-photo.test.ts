import { expect,it } from 'vitest';
import { validateVisitorPhoto } from '../src/gate/visitor-photo.js';
it('rejects unsupported, disguised and oversized photo uploads',()=>{
 expect(validateVisitorPhoto()).toBeNull();
 for(const upload of [
  {data:Buffer.from('<svg/>'),mimetype:'image/svg+xml'},
  {data:Buffer.from('<html>'),mimetype:'image/jpeg'},
  {data:Buffer.alloc(2*1024*1024+1,255),mimetype:'image/jpeg'},
 ])expect(()=>validateVisitorPhoto(upload)).toThrow(/JPEG or PNG/);
});
