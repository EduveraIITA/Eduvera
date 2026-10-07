import {BadRequestException} from "@nestjs/common";
import {createHash} from "node:crypto";
import {sql} from "kysely";
import {z} from "zod";
import {normalizeName,normalizePhone} from "./import-csv.js";
import type {CheckedRow,ClassOption,ExistingGuardian,ImportDb,ImportJob,ImportRegister,ImportRow,ImportTerm,ImportValidation,NormalizedRow} from "./import-types.js";

const studentSchema=z.object({admission_number:z.string().min(2).max(64).regex(/^[A-Z0-9/-]+$/),first_name:z.string().min(1).max(150),last_name:z.string().max(150),date_of_birth:z.iso.date(),
  roll_number:z.number().int().min(1).max(32767),enrolled_on:z.iso.date(),relationship:z.enum(["mother","father","guardian"])});
const guardianSchema=z.object({guardian_first_name:z.string().min(1).max(150),guardian_last_name:z.string().max(150),guardian_phone:z.string().regex(/^\+?[0-9 ()-]{7,25}$/),guardian_email:z.union([z.email(),z.literal("")])});
const classKey=(value:string)=>value.replace(/^class\s+/i,"").replace(/\s/g,"").toUpperCase();
const fieldErrors:Record<string,string>={admission_number:"Admission number must have 2–64 letters, numbers, slashes or hyphens.",first_name:"Enter the student's first name (up to 150 characters).",last_name:"Student last name must be 150 characters or fewer.",date_of_birth:"Enter a valid date of birth as YYYY-MM-DD.",enrolled_on:"Enter a valid enrollment date as YYYY-MM-DD.",roll_number:"Roll number must be a whole number from 1 to 32767.",relationship:"Choose mother, father or guardian.",guardian_first_name:"Enter the guardian's first name (up to 150 characters).",guardian_last_name:"Guardian last name must be 150 characters or fewer.",guardian_phone:"Enter a valid guardian contact phone number.",guardian_email:"Enter a valid guardian email address, or leave it blank."};
export async function validateImport(db:ImportDb,job:ImportJob,rows:ImportRow[]):Promise<ImportValidation>{
  const term=(await sql<ImportTerm>`SELECT t.id,t.name,t.starts_on::text,t.ends_on::text,t.is_active,t.academic_year,
    (clock_timestamp() AT TIME ZONE s.timezone)::date::text AS today FROM academic_terms t JOIN schools s ON s.id=t.school_id
    WHERE t.id=${job.term_id}::uuid AND t.school_id=${job.school_id}::uuid`.execute(db)).rows[0];
  if(!term)throw new BadRequestException("The selected school term is unavailable.");
  const classes=(await sql<ClassOption>`SELECT id,concat(grade,section) AS label,room_number AS room FROM class_sections
    WHERE school_id=${job.school_id}::uuid AND academic_year=${term.academic_year} ORDER BY grade,section,id`.execute(db)).rows;
  const checked:CheckedRow[]=rows.map(row=>{
    const errors:string[]=[],warnings:string[]=[];const v=row.values;
    if(row.decision==='skip')return {...row,errors,warnings,normalized:null,guardian_name:"",class_name:v.class};
    if(!term.is_active)errors.push("This academic term is no longer active.");
    const classMatches=classes.filter(c=>classKey(c.label)===classKey(v.class));
    if(classMatches.length!==1)errors.push("Choose an unambiguous class from this school's class list.");
    const fields={...v,admission_number:v.admission_number.toUpperCase(),roll_number:Number(v.roll_number),relationship:v.relationship.toLowerCase()};
    const valid=studentSchema.safeParse(fields);
    if(!valid.success)for(const issue of valid.error.issues)errors.push(fieldErrors[String(issue.path[0])]??"Check the student details.");
    if(valid.success){
      if(v.enrolled_on<term.starts_on||v.enrolled_on>term.ends_on)errors.push("Enrollment date must fall within this term.");
      if(v.date_of_birth>=v.enrolled_on||v.date_of_birth>term.today||v.date_of_birth<"1900-01-01")errors.push("Date of birth must precede enrollment and cannot be in the future.");
    }
    if(v.guardian_key&&!/^[A-Za-z0-9_-]{1,64}$/.test(v.guardian_key))errors.push("Family reference must be at most 64 letters, numbers, underscores or hyphens.");
    if(row.guardian_choice.mode==='new'){
      const guardian=guardianSchema.safeParse(v);
      if(!guardian.success)for(const issue of guardian.error.issues)errors.push(fieldErrors[String(issue.path[0])]??"Check the guardian details.");
    }
    const normalized=valid.success&&classMatches.length===1?{...valid.data,row_number:row.row_number,class_section_id:classMatches[0]!.id,
      guardian_group:v.guardian_key?`family:${v.guardian_key}`:row.guardian_choice.mode==='existing'?`existing:${row.guardian_choice.id}`:`row:${row.row_number}`,
      guardian_choice:row.guardian_choice,guardian_first_name:v.guardian_first_name,guardian_last_name:v.guardian_last_name,guardian_phone:v.guardian_phone,guardian_email:v.guardian_email.toLowerCase()} satisfies NormalizedRow:null;
    return {...row,errors,warnings,normalized,guardian_name:`${v.guardian_first_name} ${v.guardian_last_name}`.trim(),class_name:classMatches[0]?.label??v.class};
  });
  const included=checked.filter(r=>r.decision==='include');
  const normalized=included.flatMap(r=>r.normalized?[r.normalized]:[]);
  const admissions=normalized.map(r=>r.admission_number.toLowerCase()),classIds=[...new Set(normalized.map(r=>r.class_section_id))];
  const guardianIds=[...new Set(included.flatMap(r=>r.guardian_choice.mode==='existing'?[r.guardian_choice.id]:[]))];
  const names=[...new Set(included.map(r=>normalizeName(r.values.guardian_first_name,r.values.guardian_last_name)))];
  const phones=[...new Set(included.map(r=>normalizePhone(r.values.guardian_phone)).filter(Boolean))];
  const [existingStudents,rolls,guardians,registers]=await Promise.all([
    sql<{admission_number:string}>`SELECT admission_number FROM students WHERE school_id=${job.school_id}::uuid AND lower(admission_number)=ANY(${admissions}::text[])`.execute(db),
    sql<{class_section_id:string;roll_number:number}>`SELECT e.class_section_id,e.roll_number FROM enrollments e JOIN class_sections c ON c.id=e.class_section_id
      WHERE c.school_id=${job.school_id}::uuid AND e.term_id=${job.term_id}::uuid AND e.class_section_id=ANY(${classIds}::uuid[])`.execute(db),
    sql<ExistingGuardian>`SELECT gp.guardian_id AS id,trim(p.first_name||' '||p.last_name) AS name,p.contact_phone AS phone,p.contact_email AS email,p.revision
      FROM guardian_school_profiles gp JOIN school_people p ON p.id=gp.person_id WHERE gp.school_id=${job.school_id}::uuid AND
      (gp.guardian_id=ANY(${guardianIds}::uuid[]) OR lower(trim(p.first_name||' '||p.last_name))=ANY(${names}::text[]) OR regexp_replace(p.contact_phone,'[^0-9]','','g')=ANY(${phones}::text[])) ORDER BY gp.guardian_id`.execute(db),
    sql<ImportRegister>`SELECT id,class_section_id,date::text,state,revision FROM attendance_registers WHERE school_id=${job.school_id}::uuid AND term_id=${job.term_id}::uuid
      AND class_section_id=ANY(${classIds}::uuid[]) ORDER BY id`.execute(db),
  ]);
  const existingAdmissions=new Set(existingStudents.rows.map(r=>r.admission_number.toLowerCase()));
  const existingRolls=new Set(rolls.rows.map(r=>`${r.class_section_id}:${r.roll_number}`));
  const admissionsInFile=new Map<string,CheckedRow[]>(),rollsInFile=new Map<string,CheckedRow[]>(),groups=new Map<string,CheckedRow[]>();
  const add=(map:Map<string,CheckedRow[]>,key:string,row:CheckedRow)=>map.set(key,[...(map.get(key)??[]),row]);
  const affectedRegisters=new Map<string,ImportRegister>();
  for(const row of included){
    const r=row.normalized;if(!r)continue;
    if(existingAdmissions.has(r.admission_number.toLowerCase()))row.errors.push("Admission number already exists. Correct the number or skip this row; existing students are never overwritten.");
    const rollKey=`${r.class_section_id}:${r.roll_number}`;
    if(existingRolls.has(rollKey))row.errors.push("Roll number is already assigned in this class and term.");
    add(admissionsInFile,r.admission_number.toLowerCase(),row);add(rollsInFile,rollKey,row);add(groups,r.guardian_group,row);
    if(row.guardian_choice.mode==='existing'){
      const choice=row.guardian_choice;const guardian=guardians.rows.find(g=>g.id===choice.id);
      if(!guardian)row.errors.push("Selected guardian is no longer available in this school.");else row.guardian_name=guardian.name;
    }else if(guardians.rows.some(g=>g.name.toLowerCase()===normalizeName(r.guardian_first_name,r.guardian_last_name)||(normalizePhone(r.guardian_phone)&&normalizePhone(g.phone)===normalizePhone(r.guardian_phone)))){
      row.warnings.push("A guardian name or phone matches a school record. Select the verified existing guardian, or confirm this is a separate person.");
    }
    for(const register of registers.rows.filter(a=>a.class_section_id===r.class_section_id&&a.date>=r.enrolled_on)){
      affectedRegisters.set(register.id,register);
      if(register.state==='locked')row.errors.push(`Attendance register for ${register.date} is locked. Reopen it or correct the enrollment start date.`);
      else if(register.state==='submitted')row.warnings.push(`The ${register.date} submitted register will return to draft. Existing marks will be retained.`);
    }
  }
  for(const [map,message] of [[admissionsInFile,"Admission number is repeated in this file."],[rollsInFile,"Roll number is repeated for this class in the file."]] as const)for(const group of map.values())if(group.length>1)for(const row of group)row.errors.push(message);
  for(const group of groups.values()){
    const signatures=new Set(group.map(({normalized:r})=>r!.guardian_choice.mode==='existing'?`existing:${r!.guardian_choice.id}`:JSON.stringify([normalizeName(r!.guardian_first_name,r!.guardian_last_name),normalizePhone(r!.guardian_phone),r!.guardian_email])));
    if(signatures.size>1)for(const row of group)row.errors.push("Rows sharing a family reference must identify the same guardian. Correct the details or use separate references.");
  }
  for(const row of included){const r=row.normalized;if(!r||r.guardian_choice.mode!=='new')continue;
    if(normalized.some(other=>other.guardian_choice.mode==='new'&&other.guardian_group!==r.guardian_group&&
      (normalizeName(other.guardian_first_name,other.guardian_last_name)===normalizeName(r.guardian_first_name,r.guardian_last_name)||normalizePhone(other.guardian_phone)===normalizePhone(r.guardian_phone))))row.warnings.push("Another family reference in this file has the same guardian name or phone. Use one reference only if this is the same verified person.");
  }
  const affected=[...affectedRegisters.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const summary={total:rows.length,included:included.length,skipped:rows.length-included.length,errors:included.filter(r=>r.errors.length).length,warnings:included.filter(r=>r.warnings.length).length,
    new_guardians:[...groups.values()].filter(g=>g[0]!.guardian_choice.mode==='new').length,existing_guardians:new Set(normalized.flatMap(r=>r.guardian_choice.mode==='existing'?[r.guardian_choice.id]:[])).size,
    registers_reopened:affected.filter(r=>r.state==='submitted').length};
  const validation_token=createHash("sha256").update(JSON.stringify({id:job.id,revision:job.revision,term,rows:checked,guardians:guardians.rows,registers:affected})).digest("hex");
  return {rows:checked,classes,term,registers:affected,selected_guardians:guardians.rows.filter(g=>guardianIds.includes(g.id)),validation_token,summary};
}
