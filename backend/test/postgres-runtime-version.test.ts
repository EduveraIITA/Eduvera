import { expect,it } from 'vitest';
import { assertSupportedPostgreSqlVersion } from '../src/database/connection-policy.js';
it('rejects unsupported older database runtimes rather than quietly using14',()=>{
  for(const version of [140019,150000,160004,0,NaN])expect(()=>assertSupportedPostgreSqlVersion(version)).toThrow(/PostgreSQL17/);
  expect(()=>assertSupportedPostgreSqlVersion(170011)).not.toThrow();
});
