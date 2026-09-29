import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const IMPORT_COLUMNS = ["admission_number","first_name","last_name","date_of_birth","class","roll_number","enrolled_on","guardian_key","guardian_first_name","guardian_last_name","guardian_phone","guardian_email","relationship"] as const;
export type ImportColumn = typeof IMPORT_COLUMNS[number];
export type ImportValues = Record<ImportColumn,string>;
export const valuesSchema = z.object(Object.fromEntries(IMPORT_COLUMNS.map(key=>[key,z.string().trim().max(500).refine(value=>!value.includes(String.fromCharCode(0)),"Null characters are not supported.")])) as Record<ImportColumn,z.ZodString>).strict();
export const guardianChoiceSchema = z.discriminatedUnion("mode",[
  z.object({mode:z.literal("new")}).strict(),
  z.object({mode:z.literal("existing"),id:z.string().uuid()}).strict(),
]);
export type GuardianChoice = z.infer<typeof guardianChoiceSchema>;
export const normalizeName = (first:string,last:string)=>`${first} ${last}`.trim().toLocaleLowerCase("en");
export const normalizePhone = (phone:string)=>phone.replace(/[^0-9]/g,"");

/** RFC 4180 quoted fields, escaped quotes, CRLF/LF and UTF-8 BOM; bounded before allocation. */
export function parseImportCsv(source:string):ImportValues[]{
  if(Buffer.byteLength(source,"utf8")>512*1024)throw new BadRequestException("CSV files must be 512 KB or smaller.");
  if(source.includes(String.fromCharCode(0)))throw new BadRequestException("The file contains unsupported null characters. Save it as UTF-8 CSV.");
  const text=source.replace(/^\uFEFF/,"");
  const rows:string[][]=[];let row:string[]=[],field="",quoted=false,closed=false;
  const endField=()=>{row.push(field);field="";closed=false;if(row.length>IMPORT_COLUMNS.length)throw new BadRequestException("The CSV has too many columns. Use the school template.");};
  const endRow=()=>{endField();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>501)throw new BadRequestException("Import at most 500 students at a time.");};
  for(let i=0;i<text.length;i++){
    const ch=text[i]!;
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;}
    else if(ch===',')endField();
    else if(ch==='\r'||ch==='\n'){endRow();if(ch==='\r'&&text[i+1]==='\n')i++;}
    else if(ch==='"'){if(field.length||closed)throw new BadRequestException("Invalid quote in CSV. Put quotes around the entire field.");quoted=true;}
    else {if(closed)throw new BadRequestException("Unexpected text after a quoted CSV field.");field+=ch;}
    if(field.length>500)throw new BadRequestException("A CSV cell exceeds 500 characters.");
  }
  if(quoted)throw new BadRequestException("The CSV contains an unclosed quoted field.");
  if(field.length||row.length||closed)endRow();
  const header=rows.shift()?.map(v=>v.trim().toLowerCase());
  if(!header||header.length!==IMPORT_COLUMNS.length||new Set(header).size!==header.length||IMPORT_COLUMNS.some(c=>!header.includes(c)))throw new BadRequestException(`Use exactly these CSV columns: ${IMPORT_COLUMNS.join(", ")}.`);
  if(!rows.length)throw new BadRequestException("Add at least one student below the header row.");
  return rows.map((cells,index)=>{
    if(cells.length!==header.length)throw new BadRequestException(`Row ${index+2} has ${cells.length} fields; expected ${header.length}.`);
    return valuesSchema.parse(Object.fromEntries(header.map((key,j)=>[key,cells[j]!])));
  });
}

/** Protect spreadsheet downloads from executable formula cells. */
export function csvCell(value:string|number|null|undefined){const text=String(value??"");const safe=/^[\s]*[=+@\-\t\r]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}
