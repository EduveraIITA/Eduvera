import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
await mkdir('public/screens',{recursive:true});
await sharp('public/thatcampus-logo.png').resize({width:336}).webp({quality:90,effort:6}).toFile('public/thatcampus-logo-small.webp');
for(const name of ['overview','attendance','family','teacher','insights-desktop','planner-desktop']) {
 const path=`public/screens/${name}`;
 await sharp(`screenshots/source/${name}.png`).resize({width:name.endsWith('desktop')?1920:860,withoutEnlargement:true}).webp({quality:88,effort:6}).toFile(`${path}.webp`);
 await sharp(`screenshots/source/${name}.png`).resize({width:name.endsWith('desktop')?800:430}).webp({quality:85,effort:6}).toFile(`${path}-small.webp`);
}
