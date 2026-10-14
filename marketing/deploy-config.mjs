export function allowedDeploymentOrigins(...values){
 const origins=new Set(['https://thatcampus.com','https://www.thatcampus.com','https://thatcampus-web-367469594690.asia-south1.run.app']);
 for(const value of values){const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value||!url.hostname.endsWith('.run.app'))throw new Error('Expected an exact Cloud Run HTTPS origin');origins.add(value);}
 return [...origins].join(',');
}
