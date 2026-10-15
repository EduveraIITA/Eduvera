import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, ArrowsOut, CalendarBlank, Check, CaretRight, List, Pause, Play, Sparkle, X } from '@phosphor-icons/react';
import { motion, MotionConfig, useReducedMotion, useScroll, useTransform } from 'motion/react';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import { Enquiry, Legal, initialLogin, type Config } from './Enquiry';
import './style.css';

// Apple-inspired product storytelling for the web.
// DESIGN_VARIANCE 7 / MOTION_INTENSITY 6 / VISUAL_DENSITY 3.
const screens = {
 overview: {src:'overview',alt:'ThatCampus principal overview showing registers to submit, attendance follow-ups and the school pulse'},
 attendance: {src:'attendance',alt:'ThatCampus attendance registers grouped by period, with submission status for each class'},
 family: {src:'family',alt:'ThatCampus parent home showing a child’s attendance, leave request and today’s lessons'},
 teacher: {src:'teacher',alt:'ThatCampus teacher home showing today’s classes and attendance registers'},
 insights: {src:'insights-desktop',alt:'ThatCampus desktop insights with institution totals, attendance trends and assessment results'},
 planner: {src:'planner-desktop',alt:'ThatCampus experimental weekly timetable with subjects positioned by lesson time and duration'},
} as const;
type ScreenKey = keyof typeof screens;
type OpenScreen = (key:ScreenKey)=>void;
function Brand(){return <a className="brand" href="/" aria-label="ThatCampus home"><img src="/thatcampus-logo-small.webp" width="112" height="56" alt=""/></a>}
function ScreenImage({name,priority=false,full=false}:{name:ScreenKey;priority?:boolean;full?:boolean}) {
 const screen = screens[name];
 const wide = name==='insights'||name==='planner';
 return <img src={`/screens/${screen.src}.webp`} srcSet={full?undefined:`/screens/${screen.src}-small.webp ${wide?800:430}w, /screens/${screen.src}.webp ${wide?1920:860}w`} sizes={full?undefined:wide?'(max-width: 767px) 100vw, 1100px':'(max-width: 767px) 220px, 320px'} width={wide?1920:860} height={wide?1307:1800} alt={screen.alt} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async"/>;
}
function ScreenButton({name,onOpen,className='',priority=false}:{name:ScreenKey;onOpen:OpenScreen;className?:string;priority?:boolean}){
 return <button type="button" className={`screen-button ${className}`} onClick={()=>onOpen(name)} aria-label={`Enlarge ${name} screenshot`}><ScreenImage name={name} priority={priority}/></button>;
}
function Reveal({children,className=''}:{children:ReactNode;className?:string}) {
 const reduce = useReducedMotion();
 return <motion.div className={className} initial={false} whileInView={reduce?undefined:{y:[20,0],opacity:[0.65,1]}} viewport={{once:true,amount:0.15}} transition={{duration:0.7,ease:[0.22,1,0.36,1]}}>{children}</motion.div>;
}
function HeroScreens({onOpen,still}:{onOpen:OpenScreen;still:boolean}) {
 const target = useRef<HTMLDivElement>(null);
 const reduce = useReducedMotion();
 const {scrollYProgress} = useScroll({target,offset:['start end','end start']});
 const sideY = useTransform(scrollYProgress,[0,1],[38,-45]);
 const centerY = useTransform(scrollYProgress,[0,1],[0,-28]);
 const leftRotate = useTransform(scrollYProgress,[0,1],[-10,-5]);
 const rightRotate = useTransform(scrollYProgress,[0,1],[10,5]);
 const isStill=reduce||still;
 return <div ref={target} className="hero-stage" aria-label="Real ThatCampus application screens">
  <motion.div className="hero-phone hero-phone-left" style={isStill?{rotate:-8}:{y:sideY,rotate:leftRotate}}><ScreenButton name="attendance" onOpen={onOpen} priority/></motion.div>
  <motion.div className="hero-phone hero-phone-right" style={isStill?{rotate:8}:{y:sideY,rotate:rightRotate}}><ScreenButton name="family" onOpen={onOpen} priority/></motion.div>
  <motion.div className="hero-phone hero-phone-center" style={isStill?undefined:{y:centerY}}><ScreenButton name="overview" onOpen={onOpen} priority/></motion.div>
 </div>;
}
const workflows = [
 {name:'Attendance',key:'attendance' as const,title:'Every class. Every learner. A clearer picture.',body:'Open a period. Find the class. See which registers need attention, then follow through to the individual learner.',points:['Daily or subject-wise registers','Corrections with a recorded history','Follow-ups that lead to an outcome']},
 {name:'Insights',key:'insights' as const,title:'See the pattern. Know where to focus.',body:'Attendance trends, assessment results and teaching coverage come together in one leadership view.',points:['Institution and class-level views','Trends grounded in recorded data','Clear routes to the work behind the numbers']},
 {name:'For teachers',key:'teacher' as const,title:'Your day, already organised.',body:'Today’s classes and the work that needs your attention, ready when you arrive. Less searching between lessons.',points:['A personal teaching schedule','Direct access to each class register','Classroom work and school updates together']},
 {name:'For families',key:'family' as const,title:'Closer to their school day.',body:'Attendance, lesson schedules and requests in one familiar place. Parents can see what’s happening and what needs a response.',points:['A view for each linked child','Leave requests and school communication','The day’s activities at a glance']},
];
function ProductTour({onOpen}:{onOpen:OpenScreen}) {
 const [active,setActive] = useState(0);
 const workflow=workflows[active];
 return <section id="features" className="tour-section section">
  <Reveal className="section-intro"><h2>The school day.<br/><span>All together.</span></h2><p>See how ThatCampus brings everyday school work into focus.</p></Reveal>
  <div role="tablist" className="product-tabs" aria-label="Explore ThatCampus workflows">{workflows.map((item,index)=><button key={item.name} id={`workflow-${index}`} role="tab" aria-selected={index===active} aria-controls="workflow-panel" tabIndex={index===active?0:-1} onClick={()=>setActive(index)} onKeyDown={event=>{
   let next=index;
   if(event.key==='ArrowRight')next=(index+1)%workflows.length;else if(event.key==='ArrowLeft')next=(index+workflows.length-1)%workflows.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=workflows.length-1;else return;
   event.preventDefault();setActive(next);document.getElementById(`workflow-${next}`)?.focus();
  }}>{item.name}</button>)}</div>
  <div id="workflow-panel" role="tabpanel" aria-labelledby={`workflow-${active}`} tabIndex={0} className={`workflow-panel ${workflow.key==='insights'?'workflow-wide':''}`}>
   <div className="workflow-copy"><h3>{workflow.title}</h3><p>{workflow.body}</p><ul>{workflow.points.map(point=><li key={point}><Check size={18} aria-hidden="true"/>{point}</li>)}</ul><button className="text-link" onClick={()=>onOpen(workflow.key)}>Explore this screen <ArrowsOut size={18}/></button></div>
   <div className="workflow-visual" key={workflow.key}><ScreenButton name={workflow.key} onOpen={onOpen}/></div>
  </div>
  <p className="capture-note">Real ThatCampus screens, captured with demo school data. Select any screen to take a closer look.</p>
 </section>;
}
function Planning({onOpen,still}:{onOpen:OpenScreen;still:boolean}) {
 const target = useRef<HTMLDivElement>(null);
 const reduce = useReducedMotion();
 const {scrollYProgress} = useScroll({target,offset:['start end','center center']});
 const rotateX=useTransform(scrollYProgress,[0,1],[9,0]);
 const scale=useTransform(scrollYProgress,[0,1],[0.94,1]);
 return <section className="planning-section">
  <div className="section"><Reveal className="section-intro"><span className="eyebrow">A little more room to plan</span><h2>Give every lesson<br/><span>its place.</span></h2><p>See the week. Open a class. Plan in the space between.<br className="desktop-break"/> A timeline that puts time back in perspective.</p></Reveal>
   <div className="planning-stage" ref={target}><motion.div className="desktop-screen" style={reduce||still?undefined:{rotateX,scale}}><ScreenButton name="planner" onOpen={onOpen}/></motion.div></div>
   <div className="planning-caption"><span><CalendarBlank size={20} aria-hidden="true"/> Daily plans. Weekly schedules. One connected calendar.</span><small>Timeline experience available in Experimental settings.</small></div>
  </div>
 </section>;
}
function ConnectedPeople({onOpen}:{onOpen:OpenScreen}) {
 return <section className="people-section section" id="solutions">
  <div className="people-copy"><h2>Different roles.<br/><span>The same page.</span></h2><p>A teacher starts the day. A parent checks in. A principal sees what needs attention. Each person gets a workspace that fits their role.</p><div className="role-list"><p><strong>For school leaders</strong><span>The overview, the detail, and the next action.</span></p><p><strong>For teachers</strong><span>Classes, attendance and conversations in reach.</span></p><p><strong>For parents and students</strong><span>Schedules and updates that keep everyone involved.</span></p></div></div>
  <Reveal className="people-visual"><div className="people-phone-back"><ScreenButton name="teacher" onOpen={onOpen}/></div><div className="people-phone-front"><ScreenButton name="family" onOpen={onOpen}/></div></Reveal>
 </section>;
}
function MorePossibilities(){return <section className="possibilities section"><Reveal className="section-intro"><h2>And the little things<br/><span>that make a big day.</span></h2></Reveal><div className="possibility-grid">
 <article className="assistant-feature"><Sparkle size={36} weight="duotone" aria-hidden="true"/><h3>Just ask ThatCampus.</h3><p>Find school information, work through a question and request actions in a conversation. The assistant works with your access.</p><a className="text-link" href="#contact">Meet the assistant in a demo <ArrowRight size={18}/></a></article>
 <div className="detail-features">{[
  ['Notices & conversations','School announcements, family messages and responses, connected to the people they’re for.'],
  ['Leave & staff coverage','Requests, decisions and cover arrangements that keep the day moving.'],
  ['Your institution’s way','Roles, permissions and operating rules shaped around how your school works.'],
  ['Academics & administration','Assessments, report cards, people and fee records within the same platform.'],
 ].map(([title,body])=><article key={title}><h3>{title}</h3><p>{body}</p></article>)}</div>
 </div><p className="availability-note">We’ll confirm the right setup for your institution during your demo. Online payments are currently in sandbox testing.</p></section>}
function About(){return <section id="about" className="about-section section"><Reveal><span className="eyebrow">Made for the people behind the day</span><h2>More time for<br/><span>what school is for.</span></h2><p>ThatCampus brings the work around learning together, so the people who teach, care and lead can spend less time chasing information.</p><p className="about-detail">Built around the everyday needs of Indian schools. For colleges and other institutions, we’ll explore your attendance, scheduling and communication needs with you.</p></Reveal></section>}
function ScreenDialog({screen,onClose}:{screen:ScreenKey|null;onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;
  if(screen&&dialog&&!dialog.open){dialog.showModal();const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=before;};}
 },[screen]);
 return <dialog ref={ref} className="screen-dialog" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}} aria-label={screen?`${screen} screenshot`:'App screenshot'}><div className="screen-dialog-bar"><span>ThatCampus <small>Demo school</small></span><button autoFocus onClick={onClose} aria-label="Close screenshot"><X size={24}/></button></div>{screen&&<div className={`screen-dialog-image ${screen==='insights'||screen==='planner'?'wide':''}`}><ScreenImage name={screen} priority full/></div>}</dialog>;
}
export function App({pathname='/'}:{pathname?:string}) {
 const [config,setConfig]=useState<Config|null>(null);
 const [menu,setMenu]=useState(false);
 const [screen,setScreen]=useState<ScreenKey|null>(null);
 const [still,setStill]=useState(false);
 const legal=pathname==='/privacy'||pathname==='/terms';
 async function refresh(){try{const result=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!result.ok)throw new Error();setConfig(await result.json());}catch{setConfig(null);}}
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{if(!menu)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(false);document.getElementById('menu-toggle')?.focus();}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[menu]);
 return <MotionConfig reducedMotion="user"><a className="skip" href="#main">Skip to content</a>
  <header className="site-header"><div className="nav-inner"><Brand/><nav id="site-navigation" aria-label="Main navigation" className={menu?'nav open':'nav'}>{['Features','Solutions','About','Contact'].map(name=><a key={name} href={`${legal?'/':''}#${name.toLowerCase()}`} onClick={()=>setMenu(false)}>{name}</a>)}</nav><div className="header-actions"><a className="login" href={config?.loginUrl||initialLogin}>Login <ArrowUpRight size={15} aria-hidden="true"/></a><a className="button primary header-demo" href={`${legal?'/':''}#contact`}>Request a Demo</a><button id="menu-toggle" className="menu-button" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} aria-controls="site-navigation" onClick={()=>setMenu(!menu)}>{menu?<X size={23}/>:<List size={23}/>}</button></div></div></header>
  {legal?<div id="main"><Legal kind={pathname==='/privacy'?'privacy':'terms'}/></div>:<main id="main">
   <section className="hero"><div className="hero-copy section"><h1>Not just any campus.<br/><span>That campus.</span></h1><p>Attendance, timetables, communication and AI assistance.<br className="desktop-break"/> One shared workspace for your entire school.</p><div className="hero-actions"><a className="button primary" href="#contact">Request a Demo</a><a className="text-link" href="#features">Explore ThatCampus <CaretRight size={18} aria-hidden="true"/></a></div></div><HeroScreens onOpen={setScreen} still={still}/><div className="hero-caption"><span>Your school. Connected.</span><button className="motion-toggle" aria-label={still?'Enable parallax':'Pause parallax'} aria-pressed={still} onClick={()=>setStill(!still)}>{still?<Play size={14} weight="fill"/>:<Pause size={14} weight="fill"/>}</button></div></section>
   <ProductTour onOpen={setScreen}/><Planning onOpen={setScreen} still={still}/><ConnectedPeople onOpen={setScreen}/><MorePossibilities/><About/><Enquiry config={config} refresh={refresh}/>
  </main>}
  <footer className="site-footer section"><div className="footer-main"><Brand/><p>Not just any campus. That campus.</p><a href={config?.loginUrl||initialLogin}>Login to ThatCampus <ArrowUpRight size={16} aria-hidden="true"/></a></div><div className="footer-bottom"><span>© {new Date().getFullYear()} ThatCampus</span><div><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/#contact">Contact</a></div></div></footer>
  <ScreenDialog screen={screen} onClose={()=>setScreen(null)}/>
 </MotionConfig>;
}
