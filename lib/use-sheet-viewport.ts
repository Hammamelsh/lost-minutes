'use client';
/**
 * The phone sheet's three resting heights, measured from what is actually on the screen.
 *
 * Until 23 September 2026 the sheet's expanded height was `100dvh - 200px` in CSS and the drag's
 * snap to it was `72% of window.innerHeight` in code. Those are two different clocks. With Safari's
 * address bar and toolbar showing on a 390 × 844 phone the page is 664 px tall, the cap came to
 * 464 px (70%) and the threshold to 478 px, so an upward drag could never register as expanded and
 * every one of them snapped back to half. In Chromium's emulation, which has no browser chrome,
 * the same numbers were 644 and 608, and every check passed.
 *
 * So the heights are worked out once, here, from the *visual* viewport — the part of the page a
 * passenger can see with the browser's bars and the keyboard taken into account — and written to
 * the workspace element as custom properties for the stylesheet and read back by the drag. One
 * source, and the drag's targets are by construction reachable.
 */
import {useEffect,type RefObject} from 'react';

export const SHEET_PEEK=92;

export type SheetHeights={peek:number;half:number;full:number};

/** From the visible height and the room the search bar takes at the top: the three rest heights. */
export function sheetHeights(visibleHeight:number,topReserve:number):SheetHeights{
 const full=Math.max(260,Math.round(visibleHeight-topReserve));
 // The compact preview: about half the screen, and always leaving the expanded state clearly
 // taller than it, so the two never read as the same thing.
 const half=Math.max(200,Math.min(Math.round(visibleHeight*0.46),full-120));
 return {peek:SHEET_PEEK,half,full};
}

const PHONE_LAYOUT='(max-width:1023.98px) and (orientation:portrait),(max-width:639.98px)';

/** Read the heights the hook last wrote, for the drag to snap to; the fallbacks are the CSS ones. */
export function readSheetHeights(el:HTMLElement|null):SheetHeights{
 const cs=el?getComputedStyle(el):null;
 const px=(name:string,fallback:number)=>{
  const value=parseFloat(cs?.getPropertyValue(name)??'');
  return Number.isFinite(value)?value:fallback;
 };
 const vh=window.innerHeight;
 return {peek:SHEET_PEEK,half:px('--sheet-half',Math.round(vh*0.46)),full:px('--sheet-full',vh-200)};
}

/**
 * Keeps `--vvh`, `--vv-gap`, `--sheet-half` and `--sheet-full` current on the workspace element.
 *
 * `--vv-gap` is how far the visual viewport's bottom sits above the layout viewport's — the
 * keyboard, on iOS, which shrinks what is visible without shrinking the page — so a sheet fixed
 * to `bottom: var(--vv-gap)` sits above the keyboard rather than under it. The top reserve is
 * the search bar's own measured bottom edge, so the expanded sheet fills everything beneath the
 * one control that must stay reachable from it.
 */
export function useSheetViewport(ref:RefObject<HTMLElement|null>){
 useEffect(()=>{
  const el=ref.current;
  if(!el||typeof window==='undefined')return;
  const media=window.matchMedia(PHONE_LAYOUT);
  const vv=window.visualViewport;
  let frame=0;
  const apply=()=>{
   frame=0;
   if(!media.matches){
    for(const name of ['--vvh','--vv-gap','--sheet-half','--sheet-full'])el.style.removeProperty(name);
    return;
   }
   const height=vv?.height??window.innerHeight;
   const offsetTop=vv?.offsetTop??0;
   const gap=Math.max(0,Math.round(window.innerHeight-(offsetTop+height)));
   const bar=el.querySelector(':scope > .follow-top');
   // getBoundingClientRect is in layout-viewport coordinates; the visual viewport is offset
   // from it while zoomed or scrolled under a keyboard.
   const barBottom=bar?bar.getBoundingClientRect().bottom-offsetTop:0;
   const heights=sheetHeights(height,Math.max(0,Math.round(barBottom+8)));
   el.style.setProperty('--vvh',`${Math.round(height)}px`);
   el.style.setProperty('--vv-gap',`${gap}px`);
   el.style.setProperty('--sheet-half',`${heights.half}px`);
   el.style.setProperty('--sheet-full',`${heights.full}px`);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(apply)};
  apply();
  // The search bar lays out after the first paint, and its height is the reserve: measured once
  // at mount it read as 0 px tall, and the expanded sheet then rose under it (23 September 2026).
  const watched=new ResizeObserver(schedule);
  watched.observe(el);
  const bar=el.querySelector(':scope > .follow-top');
  if(bar)watched.observe(bar);
  vv?.addEventListener('resize',schedule);
  vv?.addEventListener('scroll',schedule);
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,{passive:true});
  media.addEventListener('change',schedule);
  return()=>{
   watched.disconnect();
   if(frame)cancelAnimationFrame(frame);
   vv?.removeEventListener('resize',schedule);
   vv?.removeEventListener('scroll',schedule);
   window.removeEventListener('resize',schedule);
   window.removeEventListener('scroll',schedule);
   media.removeEventListener('change',schedule);
  };
 },[ref]);
}
