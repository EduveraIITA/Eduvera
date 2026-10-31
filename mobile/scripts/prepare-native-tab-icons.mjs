import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(resolve(root,'package.json')),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),ts=require('typescript');
const sharp=require(createRequire(resolve(root,'../backend/package.json')).resolve('sharp'));
function load(file,dependencies) {
 const exports={},code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected icon dependency '+name);return dependencies[name];}});return exports;
}
const tokens=load(resolve(root,'src/ui/theme-tokens.ts'),{}),brand=load(resolve(root,'src/ui/assistant-brand.ts'),{}).assistantBrand;
const glyphs={today:'CalendarDots',work:'Briefcase',areas:'GridFour',more:'DotsThreeOutline'};
for(const dark of [false,true]) {
 const mode=dark?'dark':'light';
 for(const [name,glyph] of Object.entries(glyphs)) {
  const weights=load(resolve(root,`node_modules/phosphor-react-native/src/defs/${glyph}.tsx`),{'react/jsx-runtime':require('react/jsx-runtime'),'react-native-svg':{Path:'path',Circle:'circle',Rect:'rect',Line:'line',Polyline:'polyline',Polygon:'polygon',G:'g'}}).default;
  const ink=tokens.productIconAppearance(name,tokens.themePalettes.live[mode],dark).ink;
  await save(name,mode,`<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 256 256" fill="${ink}">${renderToStaticMarkup(weights.get('regular'))}</svg>`,25);
 }
 await save('assistant',mode,`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="${brand.viewBox}">${brand.feathers.map(d=>`<path d="${d}" fill="${dark?brand.featherDark:brand.feather}"/>`).join('')}<circle cx="768" cy="657" r="83" fill="${brand.dot}"/></svg>`,36);
}
async function save(name,mode,svg,size) {
 for(const scale of [1,2,3])await sharp(Buffer.from(svg)).resize(size*scale,size*scale).png().toFile(resolve(root,`assets/${name}-tab-${mode}${scale===1?'':'@'+scale+'x'}.png`));
}
