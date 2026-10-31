import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
for(const folder of ['packages/contracts','mobile']){const result=spawnSync('npm',['ci','--ignore-scripts'],{cwd:root+folder,stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status??1);}
