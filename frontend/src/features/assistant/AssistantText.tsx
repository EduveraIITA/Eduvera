import Markdown from 'react-markdown';
import type { AgentChartData } from './agentApi';

const punctuationOnly=/^[\s,;:.!?*#_-]+$/;
const bullet=/^\s*[-*•]\s+(.+)$/;

function plain(value:string) {
  return value.replace(/[*_`#]/g,'').replaceAll('[','').replaceAll(']','').replace(/\s+/g,' ').trim();
}

function markdownSafe(value:string) {
  return ['\\','`','*','_','{','}','[',']','(',')','#','+','.','!','|','-']
    .reduce((result,character)=>result.replaceAll(character,`\\${character}`),value);
}

function valueLabel(chart:AgentChartData,value:number|null) {
  if(value===null)return 'Not recorded';
  const formatted=new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(value);
  return chart.unit==='percent'?`${formatted}%`:formatted;
}

function verifiedChartSummary(chart:AgentChartData) {
  const values=chart.points.filter((point):point is typeof point & {value:number}=>point.value!==null);
  if(!values.length)return 'No recorded data is available for this period.';
  if(chart.kind==='line'){
    const latest=values.at(-1)!;
    return `Latest recorded value: **${valueLabel(chart,latest.value)}**.`;
  }
  if(chart.kind==='donut'){
    const largest=[...values].sort((a,b)=>b.value-a.value)[0]!;
    return `Largest group: ${markdownSafe(largest.label)}, **${valueLabel(chart,largest.value)}**.`;
  }
  if(values.length===1)return `${markdownSafe(values[0]!.label)} is **${valueLabel(chart,values[0]!.value)}**.`;
  const ordered=[...values].sort((a,b)=>b.value-a.value);
  const highest=ordered[0]!,lowest=ordered.at(-1)!;
  if(highest.value===lowest.value)return `All recorded values are **${valueLabel(chart,highest.value)}**.`;
  return `${markdownSafe(highest.label)} is highest at **${valueLabel(chart,highest.value)}**. ${markdownSafe(lowest.label)} is lowest at **${valueLabel(chart,lowest.value)}**.`;
}

function isChartBoilerplate(sentence:string) {
  const value=plain(sentence).toLowerCase();
  return /(?:chart|graph) (?:has been|was|is) (?:generated|created|provided|shown)/.test(value)
    || /(?:please )?(?:review|see|check) the (?:chart|graph)/.test(value)
    || /(?:figures|data|attendance).*(?:summari[sz]ed|shown) below/.test(value)
    || /figures.*(?:estimated|projected).*(?:attendance|lessons|records)/.test(value)
    || /for (?:a )?visual comparison/.test(value);
}

function duplicatesChart(block:string,chart:AgentChartData) {
  const lines=block.split('\n').map(line=>line.trim()).filter(Boolean);
  if(lines.length<2||!lines.every(line=>bullet.test(line)))return false;
  const labels=chart.points.map(point=>plain(point.label).toLowerCase());
  return lines.every(line=>{
    const item=plain(line.replace(bullet,'$1'));
    const colon=item.indexOf(':');
    if(colon<1)return false;
    const label=item.slice(0,colon).trim().toLowerCase();
    const reading=item.slice(colon+1).trim();
    return labels.some(candidate=>candidate===label)&&/^(?:-?\d+(?:\.\d+)?%?|not recorded|n\/?a)[.]?$/i.test(reading);
  });
}

/**
 * Removes chart narration the interface already communicates. It never invents
 * school data: the fallback summary is calculated only from the verified chart.
 */
export function prepareAssistantText(text:string,chart?:AgentChartData) {
  const blocks=text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(block=>block.trim()).filter(block=>block&&!punctuationOnly.test(block));
  const concise=blocks.flatMap(block=>{
    if(chart&&duplicatesChart(block,chart))return [];
    const lines=block.split('\n');
    if(lines.some(line=>bullet.test(line)))return [block];
    const sentences=block.split(/(?<=[.!?])\s+/).filter(sentence=>!chart||!isChartBoilerplate(sentence));
    const cleaned=sentences.join(' ').trim();
    return cleaned&&!punctuationOnly.test(cleaned)?[cleaned]:[];
  });
  const result=concise.join('\n\n').trim();
  return chart&&!result?verifiedChartSummary(chart):result;
}

/** Safe Markdown presentation: no model HTML, images, tables, or external links. */
export function AssistantText({text,chart,compact=false}:{text:string;chart?:AgentChartData;compact?:boolean}) {
  const content=prepareAssistantText(text,chart);
  return <div className={`assistant-markdown${compact?' assistant-markdown--compact':''}`}>
    <Markdown
      skipHtml
      unwrapDisallowed
      allowedElements={['p','strong','em','ul','ol','li','h1','h2','h3','blockquote','code']}
      components={{
        h1:({children})=><h3>{children}</h3>,
        h2:({children})=><h3>{children}</h3>,
        h3:({children})=><h3>{children}</h3>,
      }}
    >{content}</Markdown>
  </div>;
}
