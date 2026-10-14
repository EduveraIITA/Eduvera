import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedDeploymentOrigins} from '../deploy-config.mjs';
test('deployment allows the actual returned service and candidate origins without guessing',()=>{
 const values=allowedDeploymentOrigins('https://thatcampus-web-abc.a.run.app','https://check-123---thatcampus-web-abc.a.run.app').split(',');assert(values.includes('https://thatcampus-web-abc.a.run.app'));assert(values.includes('https://check-123---thatcampus-web-abc.a.run.app'));assert(values.includes('https://thatcampus.com'));assert.throws(()=>allowedDeploymentOrigins('https://attacker.example'));assert.throws(()=>allowedDeploymentOrigins('http://service.run.app'));assert.throws(()=>allowedDeploymentOrigins('https://service.run.app/path'));
});
