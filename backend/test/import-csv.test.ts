import {describe,it,expect} from "vitest";
import {IMPORT_COLUMNS,parseImportCsv,csvCell} from "../src/people/import-csv.js";
const header=IMPORT_COLUMNS.join(',');
const line='IMP-1,Ishaan,Deshmukh,2014-04-12,7A,26,2026-09-15,FAMILY-1,Nandita,Deshmukh,9000011001,,mother';
describe('Bounded school CSV parser',()=>{
  it('reads BOM, CRLF, empty last cells and reordered headers',()=>{expect(parseImportCsv(`\uFEFF${header}\r\n${line}\r\n`)[0]).toMatchObject({first_name:'Ishaan',guardian_email:''});const columns=[...IMPORT_COLUMNS].reverse();const values=parseImportCsv(`${header}\n${line}`)[0]!;expect(parseImportCsv(`${columns.join(',')}\n${columns.map(c=>values[c]).join(',')}`)[0]).toEqual(values);});
  it('preserves commas, line breaks and escaped quotes in quoted fields',()=>{const parsed=parseImportCsv(`${header}\n${line.replace('Ishaan','"Ishaan, ""Ishu""\nD"')}`);expect(parsed[0]!.first_name).toBe('Ishaan, "Ishu"\nD');});
  it('rejects malformed quoting and wrong field counts',()=>{for(const csv of [`${header}\n"bad`,`${header}\n${line},extra`,`${header}\nshort,row`,`${header}\n${line.replace('Ishaan','"Ishaan"oops')}`])expect(()=>parseImportCsv(csv)).toThrow();});
  it('rejects duplicate, unknown and missing columns',()=>{for(const headings of [header.replace('first_name','admission_number'),`${header},extra`,header.replace('guardian_email,','')])expect(()=>parseImportCsv(`${headings}\n${line}`)).toThrow();});
  it('bounds file bytes, rows and individual cells',()=>{expect(()=>parseImportCsv('x'.repeat(512*1024+1))).toThrow('512 KB');expect(()=>parseImportCsv(`${header}\n${Array(501).fill(line).join('\n')}`)).toThrow('500 students');expect(()=>parseImportCsv(`${header}\n${line.replace('Ishaan','x'.repeat(501))}`)).toThrow('500 characters');});
  it('accepts 500 rows and rejects header-only files',()=>{expect(parseImportCsv(`${header}\n${Array(500).fill(line).join('\n')}`)).toHaveLength(500);expect(()=>parseImportCsv(header)).toThrow('at least one student');});
  it('neutralizes formulas and escapes quotes in spreadsheet reports',()=>{expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');expect(csvCell('+919000011001')).toBe('"\'+919000011001"');expect(csvCell('  @SUM(A1)')).toContain("'");expect(csvCell('Ishaan')).toBe('"Ishaan"');});
});
