import {hydrateRoot} from 'react-dom/client';
import {App} from './App';
hydrateRoot(document.getElementById('root')!,<App pathname={window.location.pathname}/>);
// No network tracker is loaded. An approved, consent-aware adapter may listen
// for these allowlisted events; form fields are never included.
document.addEventListener('click',event=>{
 const anchor=event.target instanceof Element?event.target.closest('a'):null;
 if(anchor?.textContent?.includes('Login'))window.dispatchEvent(new CustomEvent('thatcampus:analytics',{detail:{event:'login_clicked'}}));
});
