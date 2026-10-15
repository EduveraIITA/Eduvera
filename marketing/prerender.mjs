import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
const origin='https://thatcampus.com';
const organization={
  '@type':'Organization','@id':`${origin}/#organization`,name:'ThatCampus',url:`${origin}/`,
  logo:{'@type':'ImageObject',url:`${origin}/thatcampus-logo.png`,width:1254,height:1254},
  slogan:'Not just any campus. That campus.',
  description:'A role-based school operations platform connecting attendance, timetables, communication and everyday work.',
};
const software={
  '@type':'SoftwareApplication','@id':`${origin}/#software`,name:'ThatCampus',url:`${origin}/school-management-software`,
  applicationCategory:'BusinessApplication',applicationSubCategory:'School management software',operatingSystem:'Web',
  audience:{'@type':'EducationalAudience',educationalRole:['administrator','teacher','student','parent']},
  featureList:['Daily and subject-wise attendance','School timetable and calendar','Parent communication','Role-based school operations','Access-aware school assistant'],
  publisher:{'@id':`${origin}/#organization`},
};
function graph(pathname,page){
 const canonical=`${origin}${pathname==='/'?'/':pathname}`;
 const nodes=[organization,software,{'@type':'WebPage','@id':`${canonical}#page`,url:canonical,name:page.title,description:page.description,isPartOf:{'@id':`${origin}/#website`},about:pathname==='/'?{'@id':`${origin}/#software`}:undefined}];
 if(pathname==='/')nodes.push({'@type':'WebSite','@id':`${origin}/#website`,url:`${origin}/`,name:'ThatCampus',publisher:{'@id':`${origin}/#organization`},inLanguage:'en-IN'});
 if(pathname.startsWith('/school-')||pathname==='/parent-communication-app'||pathname==='/ai-assistant-for-schools')nodes.push({'@type':'BreadcrumbList','@id':`${canonical}#breadcrumb`,itemListElement:[{'@type':'ListItem',position:1,name:'ThatCampus',item:`${origin}/`},{'@type':'ListItem',position:2,name:page.title.replace(/ \| ThatCampus$/,''),item:canonical}]});
 if(pathname==='/ai-assistant-for-schools')nodes.push(
  {'@type':'VideoObject',name:'ThatCampus AI: attendance context',description:'The assistant identifies an overdue attendance register, answers a follow-up and prepares a reminder for human review.',thumbnailUrl:`${origin}/demos/ai-context-poster.webp`,uploadDate:'2026-10-15T00:00:00+05:30',duration:'PT6S',contentUrl:`${origin}/demos/ai-context.mp4`,publisher:{'@id':`${origin}/#organization`}},
  {'@type':'VideoObject',name:'ThatCampus AI: sources and review',description:'The assistant keeps source checks visible beside a proposed school action that still requires human approval.',thumbnailUrl:`${origin}/demos/ai-sources-poster.webp`,uploadDate:'2026-10-15T00:00:00+05:30',duration:'PT6S',contentUrl:`${origin}/demos/ai-sources.mp4`,publisher:{'@id':`${origin}/#organization`}},
 );
 return {'@context':'https://schema.org','@graph':nodes};
}
function attribute(html,selector,value){return html.replace(selector,match=>match.replace(/content="[^"]*"/,`content="${value.replaceAll('&','&amp;').replaceAll('"','&quot;')}"`));}
function decorate(shell,pathname,page){
 const canonical=`${origin}${pathname==='/'?'/':pathname}`;
 let html=shell.replace(/<title>[^<]*<\/title>/,`<title>${page.title}</title>`);
 html=attribute(html,/<meta name="description"[^>]*>/,page.description);
 html=attribute(html,/<meta property="og:title"[^>]*>/,page.title);
 html=attribute(html,/<meta property="og:description"[^>]*>/,page.description);
 html=attribute(html,/<meta property="og:url"[^>]*>/,canonical);
 html=attribute(html,/<meta name="twitter:title"[^>]*>/,page.title);
 html=attribute(html,/<meta name="twitter:description"[^>]*>/,page.description);
 html=html.replaceAll('href="https://thatcampus.com/"',`href="${canonical}"`);
 const json=JSON.stringify(graph(pathname,page)).replaceAll('<','\\u003c');
 return html.replace('</head>',`  <script type="application/ld+json">${json}</script>\n</head>`);
}
try{
 const {App}=await vite.ssrLoadModule('/src/App.tsx');
 const {publicPaths,metaForPath}=await vite.ssrLoadModule('/src/seo.ts');
 const shell=await readFile('dist/index.html','utf8');
 for(const pathname of publicPaths){
  const rendered=renderToString(createElement(App,{pathname}));
  const html=decorate(shell.replace('<div id="root"></div>',`<div id="root">${rendered}</div>`),pathname,metaForPath(pathname));
  await writeFile(`dist/${pathname==='/'?'index':pathname.slice(1)}.html`,html);
 }
}finally{await vite.close();}
