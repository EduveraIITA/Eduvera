import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowsOut, CalendarBlank, CaretDown, Check, ChatsCircle, ClipboardText, Pause, Play, ShieldCheck, SlidersHorizontal, Sparkle, UsersThree } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
import { PhysicsBackdrop } from './PhysicsBackdrop';

type DemoName = 'attendance' | 'timetable' | 'family' | 'ai-context' | 'ai-sources';
const demos = {
  attendance: {label:'Attendance walkthrough', description:'Switch from period to class grouping, expand Class 7A and open its Mathematics register.', width:430, height:760},
  timetable: {label:'Timetable walkthrough', description:'Explore a class timetable and switch between its day and week views.', width:1440, height:900},
  family: {label:'Family walkthrough', description:'Explore a parent’s school-day overview and linked attendance information.', width:430, height:760},
  'ai-context': {label:'AI attendance walkthrough', description:'See the assistant identify the next overdue register, answer a follow-up and prepare a reminder for review.', width:430, height:760},
  'ai-sources': {label:'AI review walkthrough', description:'See how source checks and human approval stay visible beside the assistant’s proposed action.', width:430, height:760},
};

/** Bounded product media, never an authenticated iframe or a mutable live record. */
function DemoFilm({name, paused}:{name:DemoName; paused:boolean}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const largeVideo = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [localPaused, setLocalPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const demo = demos[name];
  const isAiStory = name.startsWith('ai-');
  useEffect(() => {
    const connection=(navigator as Navigator & {connection?:EventTarget & {saveData?:boolean}}).connection;
    const update=()=>setAutomatic(!connection?.saveData);
    update(); connection?.addEventListener('change',update);
    return()=>connection?.removeEventListener('change',update);
  }, []);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const load = new IntersectionObserver(([entry]) => { if(entry.isIntersecting) setNear(true); }, {rootMargin:'160px'});
    const watch = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {threshold:.25});
    load.observe(element); watch.observe(element);
    return () => { load.disconnect(); watch.disconnect(); };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => {
      if (near && visible && !expanded && !document.hidden && !paused && !localPaused && ((!reduced && automatic) || manual)) {
        void element.play().catch(() => setPlaying(false));
      } else element.pause();
    };
    sync(); document.addEventListener('visibilitychange',sync);
    return () => { element.pause(); document.removeEventListener('visibilitychange',sync); };
  }, [near,visible,paused,reduced,manual,localPaused,expanded,automatic]);
  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const element = dialog.current;
    const previous = document.body.style.overflow;
    element.showModal(); document.body.style.overflow='hidden';
    const stopWhenHidden = () => { if(document.hidden) largeVideo.current?.pause(); };
    document.addEventListener('visibilitychange',stopWhenHidden);
    return () => { largeVideo.current?.pause(); element.close(); document.body.style.overflow=previous; document.removeEventListener('visibilitychange',stopWhenHidden); };
  }, [expanded]);
  useEffect(() => { if(paused) largeVideo.current?.pause(); }, [paused]);
  function toggle() { setManual(true); setLocalPaused(playing); }
  return <div className={`demo-film demo-${name}`} ref={frame}>
    <div className="demo-device">
      <video ref={video} src={near?`/demos/${name}.mp4`:undefined} poster={near?`/demos/${name}-poster.webp`:undefined} width={demo.width} height={demo.height} muted loop playsInline preload="none" aria-label={demo.label} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setFailed(true)}/>
    </div>
    <div className="film-controls">
      <button type="button" onClick={toggle} disabled={paused || failed} aria-label={`${playing?'Pause':'Play'} ${demo.label.toLowerCase()}`}>{playing?<Pause weight="fill" size={14}/>:<Play weight="fill" size={14}/>}<span>{playing?'Pause':'Play'}</span></button>
      <button type="button" onClick={()=>setExpanded(true)} aria-label={`Enlarge ${demo.label.toLowerCase()}`}><ArrowsOut size={16}/><span>Enlarge</span></button>
    </div>
    {failed&&<p className="film-fallback">Preview unavailable. Explore the screen gallery below.</p>}
    <dialog ref={dialog} className="film-dialog" aria-label={demo.label} onCancel={()=>setExpanded(false)} onClick={event=>{if(event.target===event.currentTarget)setExpanded(false);}}>
      <div className="film-dialog-heading"><div><strong>{demo.label}</strong><p>{isAiStory?'Illustrative ThatCampus AI interaction':'Recorded in the ThatCampus demo app'}</p></div><button className="button secondary" autoFocus onClick={()=>setExpanded(false)}>Close</button></div>
      {expanded&&<video ref={largeVideo} src={`/demos/${name}.mp4`} poster={`/demos/${name}-poster.webp`} width={demo.width} height={demo.height} controls playsInline preload="metadata" aria-label={demo.label}/>}
      <p>{demo.description} Sample school data; this preview does not change records.</p>
    </dialog>
  </div>;
}

export function Capabilities({paused}:{paused:boolean}) {
  const reduce=useReducedMotion();
  const reveal = paused||reduce ? {} : {whileInView:{y:[18,0]},viewport:{once:true,amount:.15},transition:{type:'spring' as const,stiffness:80,damping:22}};
  return <section className="story-section section" id="in-action">
    <div className="story-heading"><span className="eyebrow">See the school day in motion</span><h2>Less chasing.<br/><span>More moving forward.</span></h2><p>From the first register to the next family update, see how the everyday work comes together.</p></div>
    <div className="story-grid">
      <motion.article className="feature-scene attendance-scene" {...reveal}>
        <div className="scene-copy"><ClipboardText size={26} aria-hidden="true"/><h3>Know exactly<br/>where to act.</h3><p>Start with the whole school. Choose a class. Reach the register that needs attention.</p><ol className="workflow-steps"><li><span>Find the priority</span><small>Registers grouped by class or period</small></li><li><span>See the detail</span><small>Submission status at the source</small></li><li><span>Follow through</span><small>Open the register and its recorded decisions</small></li></ol><a className="text-link" href="#features">Explore attendance <ArrowRight size={18}/></a></div>
        <div className="scene-stage"><PhysicsBackdrop variant="flow" paused={paused}/><DemoFilm name="attendance" paused={paused}/></div>
      </motion.article>
      <motion.article className="feature-scene timetable-scene" {...reveal}>
        <div className="scene-copy"><CalendarBlank size={26} aria-hidden="true"/><h3>A place for<br/>every lesson.</h3><p>See classes in the context of the day. Move between the detail and the whole week.</p></div>
        <div className="scene-stage"><PhysicsBackdrop variant="grid" paused={paused}/><DemoFilm name="timetable" paused={paused}/></div>
        <p className="scene-footnote">Timeline view available in Experimental settings.</p>
      </motion.article>
      <motion.article className="feature-scene family-scene" {...reveal}>
        <div className="scene-copy"><ChatsCircle size={26} aria-hidden="true"/><h3>Bring families<br/>into the picture.</h3><p>Attendance, lessons and requests in a view built around their child.</p></div>
        <div className="scene-stage"><PhysicsBackdrop variant="orbit" paused={paused}/><DemoFilm name="family" paused={paused}/></div>
      </motion.article>
    </div>
    <div className="ai-film-section"><div className="ai-film-copy"><span className="eyebrow">ThatCampus AI</span><h3>Ask in context.<br/><span>Keep people in control.</span></h3><p>See a connected attendance workflow: the assistant finds the next overdue register, names who needs a follow-up and prepares a reminder without sending it.</p><ul><li><Check size={17}/> Answers grounded in school records</li><li><Check size={17}/> Source checks stay visible</li><li><Check size={17}/> Proposed changes still require review</li></ul></div><div className="ai-film-grid"><DemoFilm name="ai-context" paused={paused}/><DemoFilm name="ai-sources" paused={paused}/></div></div>
    <p className="demo-provenance">App walkthroughs use synthetic school data. The AI examples are illustrative product interactions; the public demo does not run a model. Play, pause or enlarge any walkthrough.</p>
  </section>;
}

const roles=[
  {name:'Principal',screen:'insights-desktop',title:'The bigger picture. The next action.',description:'Attendance patterns, assessment results and operational attention in one leadership workspace.',points:['See institution and class-level trends','Find the work behind the numbers','Give your team role-specific access']},
  {name:'Teacher',screen:'teacher',title:'Start with your day already organised.',description:'Move from your teaching schedule to the right class register, with school updates close at hand.',points:['Your classes and registers together','School conversations in one place','Less searching between lessons']},
  {name:'Parent',screen:'family',title:'Stay close to their school day.',description:'See attendance, schedules and requests in a workspace built around your family.',points:['A view for each linked child','Leave requests and school updates','The day’s lessons at a glance']},
  {name:'Student',screen:'teacher',title:'A clearer day for every learner.',description:'Class schedules, school updates and attendance information are available according to the institution’s setup.',points:['No student phone needed for core workflows','Adults can manage operational records','Student access is shaped by the institution']},
] as const;
export function RoleBenefits(){
  const [active,setActive]=useState(0); const role=roles[active];
  return <section className="role-section section" id="role-workspaces"><div className="story-heading"><h2>One campus.<br/><span>Every perspective.</span></h2><p>The same school day, organised around what each person needs to do.</p></div>
    <div className="role-workspace"><div className="role-navigation"><div className="role-tabs" role="tablist" aria-label="Campus roles">{roles.map((item,i)=><button key={item.name} id={`role-${i}`} role="tab" aria-selected={active===i} aria-controls="role-panel" tabIndex={active===i?0:-1} onClick={()=>setActive(i)} onKeyDown={event=>{let next=i;if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(i+1)%4;else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(i+3)%4;else if(event.key==='Home')next=0;else if(event.key==='End')next=3;else return;event.preventDefault();setActive(next);document.getElementById(`role-${next}`)?.focus();}}>{item.name}<ArrowRight size={18}/></button>)}</div>
      <div id="role-panel" role="tabpanel" aria-labelledby={`role-${active}`} tabIndex={0}><h3>{role.title}</h3><p>{role.description}</p><ul>{role.points.map(point=><li key={point}><Check size={17}/>{point}</li>)}</ul></div></div>
      <div className={`role-proof ${active===0?'role-proof-wide':''}`}>
        {active===3
          ? <div className="student-principle"><UsersThree size={48} weight="duotone"/><h3>People first.<br/>Devices optional.</h3><p>The student is at the centre of the school day. A personal phone doesn’t have to be.</p><a className="text-link" href="#contact">Book a walkthrough <ArrowRight size={18}/></a></div>
          : <img key={role.screen} src={`/screens/${role.screen}.webp`} width={active===0?1920:860} height={active===0?1307:1800} loading="lazy" alt={`Real ${role.name.toLowerCase()} workspace with sample school data`}/>
        }
      </div>
    </div>
  </section>;
}

export function Solutions(){return <section id="institution-solutions" className="fit-section section"><div className="fit-intro"><span className="eyebrow">Your institution’s way</span><h2>A shared system.<br/><span>Your operating rules.</span></h2><p>Start with the daily work that matters most to your school. Configure access and supported workflows around your team.</p><a className="button primary" href="#contact">Book a walkthrough <ArrowRight size={17}/></a></div><div className="fit-details">{[
  [SlidersHorizontal,'Attendance that fits your day','Daily or subject-wise registers, with configurable submission and finalisation rules.'],
  [ShieldCheck,'Access with a purpose','Institution-scoped roles and permissions determine which records and actions each person can use.'],
  [Sparkle,'An assistant within your team’s access','Ask about school information and request supported actions. The system applies permissions and required review.'],
  [UsersThree,'Begin with your school','Built around Indian schools. For colleges, coaching centres and universities, we’ll review your attendance and scheduling requirements together.'],
].map(([Icon,title,body])=>{const Glyph=Icon as typeof ShieldCheck;return <details key={String(title)}><summary><Glyph size={22}/><span>{String(title)}</span><CaretDown size={18}/></summary><p>{String(body)}</p></details>;})}<p className="fit-disclosure">Online payments are currently in sandbox testing. Product availability depends on your institution’s setup.</p></div></section>}
