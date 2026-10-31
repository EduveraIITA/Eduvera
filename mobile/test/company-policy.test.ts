import test from 'node:test';
import assert from 'node:assert/strict';
import { companyInstitutionBody, normalizeInstitutionCode, type DirectoryInstitution } from '../src/lib/company-policy';
const manual={name:'Sample College',institution_type:'college',state:'Delhi',district:'',city:'Delhi',address:'Public campus address'};
const input={manual,selected:null,code:' Sample College ',timezone:'Asia/Kolkata',email:'admin@example.test',duplicates:[] as DirectoryInstitution[],acknowledged:false};
test('company creation preserves manual/unverified source and explicit administrator details',()=>{
 const value=companyInstitutionBody(input); assert.equal(value.code,'sample-college');assert.equal(value.institution_kind,'college');assert.equal('manual' in value && value.manual,manual);assert.equal('directory_id' in value,false);assert.deepEqual(value.acknowledged_duplicate_ids,[]);
 assert.equal(normalizeInstitutionCode(' École / One '),'ecole-one');
});
test('company creation cannot bypass current duplicate review or onboarded source',()=>{
 const duplicates=[{eduera_institution_id:'11111111-1111-4111-8111-111111111111'}] as DirectoryInstitution[];
 assert.throws(()=>companyInstitutionBody({...input,duplicates}));
 assert.deepEqual(companyInstitutionBody({...input,duplicates,acknowledged:true}).acknowledged_duplicate_ids,[duplicates[0]!.eduera_institution_id]);
 assert.throws(()=>companyInstitutionBody({...input,selected:{is_onboarded:true} as DirectoryInstitution}));
 assert.throws(()=>companyInstitutionBody({...input,duplicates:[{eduera_institution_id:null} as DirectoryInstitution],acknowledged:true}));
});
test('company creation rejects incomplete identity, invalid timezone or malformed contact',()=>{
 for(const changed of [{manual:{...manual,city:'',district:''}},{manual:{...manual,address:''}},{timezone:'not/a/timezone'},{email:'unrelated'},{code:'x'}]) assert.throws(()=>companyInstitutionBody({...input,...changed}));
});
