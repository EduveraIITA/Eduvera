import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try{const {App}=await vite.ssrLoadModule('/src/App.tsx');const shell=await readFile('dist/index.html','utf8');for(const pathname of ['/','/privacy','/terms']){const html=shell.replace('<div id="root"></div>',`<div id="root">${renderToString(createElement(App,{pathname}))}</div>`);await writeFile(`dist/${pathname==='/'?'index':pathname.slice(1)}.html`,html);}}finally{await vite.close();}
