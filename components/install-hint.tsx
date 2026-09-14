"use client";

import {useEffect,useState,useSyncExternalStore} from 'react';

type InstallPrompt=Event&{prompt:()=>Promise<void>};
/** Addresses that will not last: a temporary trial tunnel, or this machine itself. */
const TEMPORARY=/(^|\.)trycloudflare\.com$|^localhost$|^127\.0\.0\.1$/;
const never=()=>()=>{};
function environment(){
 const installed=window.matchMedia?.('(display-mode: standalone)').matches
  ||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 return installed?'installed':TEMPORARY.test(location.hostname)?'temporary':ios?'ios':'other';
}

/**
 * Keeping the app on the home screen, said for the browser in hand, beside the passenger's saved
 * stops. Only where the address will last: on a temporary trial link it says instead that the link
 * is temporary, because a home-screen icon for it would stop working when the trial ends. Nothing
 * is shown once the app is installed.
 */
export default function InstallHint(){
 const where=useSyncExternalStore(never,environment,()=>'server');
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null);
 useEffect(()=>{
  const capture=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt)};
  addEventListener('beforeinstallprompt',capture);
  return()=>removeEventListener('beforeinstallprompt',capture);
 },[]);
 if(where==='server'||where==='installed')return null;
 if(where==='temporary')return <p className="saved-note">Saved on this phone, for this address. This address is
  temporary (a trial link), so it is not worth adding to your home screen.</p>;
 if(prompt)return <p className="saved-note">Saved on this phone. <button className="text-action"
  onClick={()=>{prompt.prompt().catch(()=>{});setPrompt(null)}}>Install Lost Minutes</button> to open it from
  your home screen.</p>;
 return <p className="saved-note">Saved on this phone. To open it from your home screen, {where==='ios'
  ?'use Safari’s Share button, then Add to Home Screen.':'use your browser’s menu, then Add to Home screen or Install app.'}</p>;
}
