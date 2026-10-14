import { describe, expect, it } from 'vitest';
import { assertGateTransition, assertPassUsable, gateTokenHash, newGateToken } from '../src/gate/gate.rules.js';
import { DEFAULT_STAFF_PERMISSIONS, PERMISSIONS } from '../src/roles/permissions.js';
describe('gate passes and factual movements',()=>{
 it('uses unguessable opaque QR tokens and stores only their hashes',()=>{const token=newGateToken();expect(token).toMatch(/^eduera-gate:/);expect(gateTokenHash(token)).toHaveLength(64);expect(gateTokenHash(token)).not.toContain(token);expect(newGateToken()).not.toBe(token);});
 it('rejects raw student ids, copied URLs and numeric codes',()=>{for(const value of ['123456','aabbcc','https://evil.test/eduera-gate:abc'])expect(()=>gateTokenHash(value)).toThrow();});
 it('rejects expired, revoked and already-used QR passes',()=>{for(const pass of [{expires_at:new Date(0),used_at:null,revoked_at:null},{expires_at:new Date(Date.now()+10000),used_at:new Date(),revoked_at:null},{expires_at:new Date(Date.now()+10000),used_at:null,revoked_at:new Date()}])expect(()=>assertPassUsable(pass)).toThrow();});
 it('allows only alternating movements and blocks exit without a recorded entry',()=>{expect(()=>assertGateTransition(undefined,'in')).not.toThrow();expect(()=>assertGateTransition('out','in')).not.toThrow();expect(()=>assertGateTransition('in','out')).not.toThrow();for(const [old,next] of [[undefined,'out'],['in','in'],['out','out']])expect(()=>assertGateTransition(old,next!)).toThrow();});
 it('does not grant gate access to ordinary teaching staff by default',()=>{expect(PERMISSIONS.find(p=>p.code==='gate.manage')?.label).toBe('Manage In & Out');expect(DEFAULT_STAFF_PERMISSIONS).not.toContain('gate.manage');});
});
