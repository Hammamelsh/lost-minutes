import type {MapTheme} from '@/lib/map-style';

/** The map theme: the passenger's choice if they made one, else their system's light or dark
 *  preference. Device-local; never sent anywhere. */
const STORE='lost-minutes.map-theme.v1';
const listeners=new Set<()=>void>();
const DARK='(prefers-color-scheme: dark)';

function stored():MapTheme|null{
 try{const value=window.localStorage.getItem(STORE);return value==='day'||value==='night'?value:null}
 catch{return null}
}

function system():MapTheme{
 try{return window.matchMedia(DARK).matches?'night':'day'}catch{return 'day'}
}

export const themeSnapshot=():MapTheme=>stored()??system();
export const themeServerSnapshot=():MapTheme=>'day';

export function subscribeTheme(callback:()=>void){
 listeners.add(callback);
 const media=typeof window.matchMedia==='function'?window.matchMedia(DARK):null;
 media?.addEventListener?.('change',callback);
 const onStorage=(event:StorageEvent)=>{if(event.key===STORE||event.key===null)callback()};
 window.addEventListener('storage',onStorage);
 return()=>{listeners.delete(callback);media?.removeEventListener?.('change',callback);
            window.removeEventListener('storage',onStorage)};
}

export function saveTheme(theme:MapTheme){
 try{window.localStorage.setItem(STORE,theme)}catch{/* a refused store still switches for this visit */}
 listeners.forEach(callback=>callback());
}
