import {describe,expect,it} from 'vitest';
import {isPublishedDemoPassword,validatePassword} from '../src/auth/password.js';
describe('published credentials',()=>{
 it('rejects the public fixture password for password setup and detects casing variants',()=>{
  expect(isPublishedDemoPassword('OmniDemo@2026')).toBe(true);
  expect(isPublishedDemoPassword('OMNIDEMO@2026')).toBe(true);
  expect(validatePassword('OmniDemo@2026').join(' ')).toContain('publicly known');
  expect(isPublishedDemoPassword('A-private-generated-value!')).toBe(false);
 });
});
