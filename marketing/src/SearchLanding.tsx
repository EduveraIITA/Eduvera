import { ArrowRight, Check } from '@phosphor-icons/react';
import type { Config } from './Enquiry';
import type { SolutionPage } from './seo';
import { solutionByPath } from './seo';
import './search.css';

const initialDemo = 'https://app.thatcampus.com/demo';

function ProductProof({ page }: { page: SolutionPage }) {
  if (page.path === '/ai-assistant-for-schools') {
    return <div className="search-ai-proof" aria-label="ThatCampus AI product demonstrations">
      {[
        ['ai-context', 'ThatCampus AI finds an overdue attendance register and prepares a reminder for review.'],
        ['ai-sources', 'ThatCampus AI keeps source checks visible beside a proposed action.'],
      ].map(([name, label]) => <video key={name} controls playsInline preload="metadata" poster={`/demos/${name}-poster.webp`} width="430" height="760" aria-label={label}>
        <source src={`/demos/${name}.mp4`} type="video/mp4"/>
        {label}
      </video>)}
    </div>;
  }
  const wide = page.screenWidth > 1000;
  return <picture>
    <source media="(max-width: 767px)" srcSet={`/screens/${page.screen}-small.webp`}/>
    <img className={wide ? 'is-wide' : ''} src={`/screens/${page.screen}.webp`} width={page.screenWidth} height={page.screenHeight} alt={page.screenAlt} fetchPriority="high" decoding="async"/>
  </picture>;
}

export function SearchLanding({ page, config }: { page: SolutionPage; config: Config | null }) {
  return <main id="main" className="search-page">
    <section className="search-hero section">
      <div className="search-hero-copy">
        <span className="eyebrow">{page.eyebrow}</span>
        <h1>{page.heading}</h1>
        <p>{page.lead}</p>
        <div className="search-actions">
          <a className="button primary" href={config?.demoUrl || initialDemo}>Explore the public demo <ArrowRight size={17} aria-hidden="true"/></a>
          <a className="text-link" href="/#contact">Book a personal walkthrough <ArrowRight size={16} aria-hidden="true"/></a>
        </div>
        <small>No account required. Synthetic sample data. Read-only.</small>
      </div>
      <div className={`search-proof ${page.screenWidth > 1000 ? 'search-proof-wide' : ''}`}>
        <ProductProof page={page}/>
        <p>{page.proof}</p>
      </div>
    </section>

    <section className="search-outcomes section" aria-labelledby="outcome-heading">
      <div className="search-section-heading"><span>What it changes</span><h2 id="outcome-heading">Less chasing. A clearer next step.</h2></div>
      <div className="search-outcome-list">{page.outcomes.map(item => <article key={item.title}><Check size={22} aria-hidden="true"/><div><h3>{item.title}</h3><p>{item.body}</p></div></article>)}</div>
    </section>

    <section className="search-workflow section" aria-labelledby="workflow-heading">
      <div className="search-section-heading"><span>How the workflow fits together</span><h2 id="workflow-heading">Understand the work before asking people to act.</h2></div>
      <ol>{page.steps.map((step, index) => <li key={step.title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol>
    </section>

    <section className="search-questions section" aria-labelledby="questions-heading">
      <div className="search-section-heading"><span>Useful detail</span><h2 id="questions-heading">Questions schools ask.</h2></div>
      <div>{page.questions.map(item => <article key={item.question}><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div>
    </section>

    <nav className="search-related section" aria-label="Related ThatCampus solutions">
      <span>Explore related workflows</span>
      <div>{page.related.map(path => { const item = solutionByPath[path]; return <a key={path} href={path}>{item.eyebrow}<ArrowRight size={15} aria-hidden="true"/></a>; })}</div>
    </nav>

    <section className="search-close section">
      <div><span className="eyebrow">See it with your school in mind</span><h2>Explore first. Talk when you’re ready.</h2><p>Use the public demo immediately, or leave one email address or phone number for a personal walkthrough.</p></div>
      <div><a className="button primary" href={config?.demoUrl || initialDemo}>Try the app <ArrowRight size={17} aria-hidden="true"/></a><a className="button secondary" href="/#contact">Contact ThatCampus</a></div>
    </section>
  </main>;
}
