/** Small, safe text presentation: emphasis only, never model-generated HTML or links. */
export function AssistantText({text}:{text:string}) {
  return <>{text.split(/(\*\*[^*]{1,300}\*\*)/g).map((part,index)=>part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part)}</>;
}
