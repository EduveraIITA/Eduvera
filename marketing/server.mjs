import {createServer} from 'node:http';
import {readFile,open} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
const compress=promisify(gzip);

const fallbackLogin='https://app.thatcampus.com/login';
export function settings(env=process.env){
 const loginUrl=new URL(env.LOGIN_URL||fallbackLogin);
 if(loginUrl.protocol!=='https:'||loginUrl.pathname!=='/login'||loginUrl.search||loginUrl.hash||loginUrl.username||loginUrl.password)throw new Error('LOGIN_URL must be an exact HTTPS /login URL');
 const production=env.NODE_ENV==='production';
 if(production&&(!env.FORM_SECRET||env.FORM_SECRET.length<32||!env.DATABASE_URL))throw new Error('DATABASE_URL and a random FORM_SECRET of at least 32 characters are required');
 return {loginUrl:loginUrl.href,secret:env.FORM_SECRET||'development-only-do-not-use-in-production',production,origins:(env.ALLOWED_ORIGINS||'http://localhost:8080,http://127.0.0.1:8080').split(',').map(s=>s.trim()),dist:resolve(env.DIST_DIR||'dist'),release:env.RELEASE_SHA||'local'};
}
export function validateEnquiry(data,now=Date.now()){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Please check the form details.');
 const text=(name,min,max)=>{const value=data[name];if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new Error(`Please check ${name}.`);return value.trim();};
 const result={fullName:text('fullName',2,100),institution:text('institution',2,180),institutionType:text('institutionType',1,20),email:text('email',3,254).toLowerCase(),phone:text('phone',7,30),location:text('location',2,160),message: data.message===undefined?'':text('message',0,2000),students:data.students};
 if(!['school','college','university','other'].includes(result.institutionType)||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email)||!/^\+?[\d () .-]+$/.test(result.phone)||result.phone.replace(/\D/g,'').length<7||!Number.isSafeInteger(result.students)||result.students<1||result.students>1000000||data.consent!=='yes'||(data.website&&data.website!=='')||!Number.isSafeInteger(data.startedAt)||now-data.startedAt<2000||now-data.startedAt>86400000)throw new Error('Please check the form details and try again.');
 return result;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.woff':'font/woff','.xml':'application/xml','.txt':'text/plain'};
function sign(value,secret){return createHmac('sha256',secret).update(value).digest('hex');}
function validToken(token,secret){if(typeof token!=='string'||!/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token))return false;const [time,nonce,signature]=token.split('.');if(Date.now()-Number(time)>1800000||Number(time)>Date.now())return false;return timingSafeEqual(Buffer.from(signature),Buffer.from(sign(`${time}.${nonce}`,secret)));}
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function byteRange(value,size){
 // RFC 9110 allows ignoring malformed/unsupported ranges. Keep parsing bounded,
 // support one interval only, and use BigInt before clipping large numerals.
 if(typeof value!=='string'||value.length>256||size===0)return null;
 const match=/^bytes=[\t ]*(\d*)-(\d*)[\t ]*$/i.exec(value);
 if(!match||(!match[1]&&!match[2]))return null;
 const length=BigInt(size);
 if(!match[1]){const suffix=BigInt(match[2]);if(suffix===0n)return false;return {start:Number(suffix>=length?0n:length-suffix),end:size-1};}
 const start=BigInt(match[1]);let end=match[2]?BigInt(match[2]):length-1n;
 if(match[2]&&end<start)return null;
 if(start>=length)return false;
 if(end>=length)end=length-1n;
 return {start:Number(start),end:Number(end)};
}
async function video(req,res,filename,cacheControl){
 let handle;try{handle=await open(filename,'r');}catch{json(res,404,{message:'Not found'});return;}
 try{
 const file=await handle.stat();
 if(!file.isFile()){json(res,404,{message:'Not found'});return;}
 if(!Number.isSafeInteger(file.size)||file.size<0)throw new Error('Unsupported media size');
 const headers={'Content-Type':mime['.mp4'],'Accept-Ranges':'bytes','Cache-Control':cacheControl,'Content-Length':file.size};
 // Range only applies to GET. Without a representation validator, If-Range
 // must receive the complete file rather than risk joining different versions.
 const range=req.method==='GET'&&!req.headers['if-range']?byteRange(req.headers.range,file.size):null;
 if(range===false){res.writeHead(416,{...headers,'Content-Range':`bytes */${file.size}`,'Content-Length':0,'Cache-Control':'no-store'});res.end();return;}
 if(range){headers['Content-Range']=`bytes ${range.start}-${range.end}/${file.size}`;headers['Content-Length']=range.end-range.start+1;}
 res.writeHead(range?206:200,headers);
 if(req.method==='HEAD'||file.size===0){res.end();return;}
 await pipeline(handle.createReadStream({start:range?.start??0,end:range?.end??file.size-1,autoClose:false}),res);
 }catch(error){if(res.headersSent){res.destroy();return;}throw error;}finally{await handle.close();}
}
export function createHandler({db,config=settings(),clock=()=>Date.now()}){return async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
 // Cloudflare forwards the public hostname while Cloud Run keeps its own Host.
 // This only selects SEO headers; it grants no application or form permissions.
 const publicHost=req.headers['x-forwarded-host']||req.headers.host;
 if(config.production){res.setHeader('Strict-Transport-Security','max-age=31536000');if(!['thatcampus.com','www.thatcampus.com'].includes(publicHost))res.setHeader('X-Robots-Tag','noindex');}
 try{
 const url=new URL(req.url,'http://internal');
 if(req.headers.host==='www.thatcampus.com'){res.writeHead(308,{Location:`https://thatcampus.com${url.pathname}${url.search}`});res.end();return;}
 if(url.pathname==='/healthz'){json(res,200,{status:'ok',release:config.release});return;}
 if(url.pathname==='/readyz'){await db.query('SELECT 1 FROM marketing_enquiries LIMIT 0');json(res,200,{status:'ready',release:config.release});return;}
 if(url.pathname==='/api/config'&&req.method==='GET'){
 const payload=`${Date.now()}.${randomBytes(16).toString('hex')}`;const csrfToken=`${payload}.${sign(payload,config.secret)}`;
 res.setHeader('Set-Cookie',`tc_form=${csrfToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${config.production?'; Secure':''}`);json(res,200,{loginUrl:config.loginUrl,csrfToken});return;
 }
 if(url.pathname==='/api/enquiries'&&req.method==='POST'){
 if(!config.origins.includes(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'){json(res,403,{message:'Refresh the page and try again.'});return;}
 const token=req.headers['x-csrf-token'];const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('tc_form='))?.slice(8);
 if(token!==cookie||!validToken(token,config.secret)){json(res,403,{message:'Your form session expired. Refresh the page and try again.'});return;}
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){json(res,415,{message:'JSON content is required.'});return;}
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>12000){json(res,413,{message:'This request is too large.'});return;}}
 let data;try{data=validateEnquiry(JSON.parse(raw),clock());}catch{json(res,400,{message:'Please check all required fields, then try again.'});return;}
 // Cloud Run appends a trusted client address to X-Forwarded-For. The final
 // address is used; never trust a caller-controlled left-most address.
 const network=(config.production?String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim():req.socket.remoteAddress)||'unknown';
 const bucket=sign(`${new Date(clock()).toISOString().slice(0,13)}:${network}`,config.secret);
 const client=await db.connect();try{await client.query('BEGIN');
 const hit=await client.query(`INSERT INTO marketing_rate_limits(bucket_key,hits,expires_at) VALUES($1,1,now()+interval '2 hours') ON CONFLICT(bucket_key) DO UPDATE SET hits=marketing_rate_limits.hits+1 RETURNING hits`,[bucket]);
 if(hit.rows[0].hits>5){await client.query('COMMIT');res.setHeader('Retry-After','3600');json(res,429,{message:'Too many requests. Please try again later.'});return;}
 const fingerprint=sign(JSON.stringify(data),config.secret);
 const saved=await client.query(`INSERT INTO marketing_enquiries(full_name,institution_name,institution_type,email,phone,location,student_count,message,consent_version,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-10-14',$9) ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id`,[data.fullName,data.institution,data.institutionType,data.email,data.phone,data.location,data.students,data.message,fingerprint]);
 await client.query(`INSERT INTO marketing_notification_jobs(enquiry_id) VALUES($1) ON CONFLICT(enquiry_id) DO NOTHING`,[saved.rows[0].id]);
 await client.query('COMMIT');json(res,201,{message:'Your enquiry has been saved.',reference:saved.rows[0].id});return;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 if(url.pathname.startsWith('/api/')){json(res,404,{message:'Not found'});return;}
 if(!['GET','HEAD'].includes(req.method)){json(res,405,{message:'Method not allowed'});return;}
 let path;try{path=decodeURIComponent(url.pathname);}catch{json(res,400,{message:'Invalid path'});return;}
 const page=['/','/privacy','/terms'].includes(path);
 const filename=page?resolve(config.dist,path==='/'?'index.html':`${path.slice(1)}.html`):resolve(config.dist,`.${path}`);
 if(!filename.startsWith(config.dist+sep)){json(res,404,{message:'Not found'});return;}
 const cacheControl=page?'no-cache':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'public, max-age=3600';
 if(extname(filename)==='.mp4'){await video(req,res,filename,cacheControl);return;}
 let file;try{file=await readFile(filename);}catch{json(res,404,{message:'Not found'});return;}
 if(page){let html=file.toString();if(path!=='/'){const title=path==='/privacy'?'Privacy Policy':'Terms of Service';html=html.replace('<title>ThatCampus | Not just any campus. That campus.</title>',`<title>${title} — ThatCampus</title>`).replaceAll('https://thatcampus.com/"',`https://thatcampus.com${path}"`);}file=Buffer.from(html);}
 const type=mime[extname(filename)]||'application/octet-stream';
 const acceptsGzip=String(req.headers['accept-encoding']||'').split(',').some(part=>{const [encoding,...parameters]=part.trim().split(';');const quality=parameters.find(p=>p.trim().startsWith('q='));return encoding==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);});
 res.setHeader('Vary','Accept-Encoding');
 if(file.length>1024&&acceptsGzip&&/^(text\/|application\/xml)/.test(type)){file=await compress(file);res.setHeader('Content-Encoding','gzip');}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':cacheControl});res.end(req.method==='HEAD'?undefined:file);
 }catch{json(res,503,{message:'We could not confirm your request. Please try again shortly.'});}
};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const {Pool}=await import('pg');const config=settings();
 // Cloud SQL Unix sockets need no TLS. Remote providers must verify TLS.
 const dbUrl=new URL(process.env.DATABASE_URL);const socket=dbUrl.searchParams.get('host');
 const local=socket?.startsWith('/cloudsql/')||['localhost','127.0.0.1'].includes(dbUrl.hostname);
 if(config.production&&!local&&!['verify-full','verify-ca'].includes(dbUrl.searchParams.get('sslmode')))throw new Error('Remote DATABASE_URL requires sslmode=verify-full or verify-ca');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});
 const server=createServer(createHandler({db:pool,config}));server.requestTimeout=15000;server.headersTimeout=10000;
 server.listen(Number(process.env.PORT||8080),'0.0.0.0');
 process.on('SIGTERM',()=>{server.close(()=>{void pool.end();});});
}
