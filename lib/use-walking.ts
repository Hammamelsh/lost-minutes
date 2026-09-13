"use client";

import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {fetchWalkingRoute,preflight,rerouteDecision,roundForRouting,WALKING_CONSENT_KEY,
        type LatLon,type RouteRequest,type WalkingConfig,type WalkingProblem,type WalkingRoute} from '@/lib/walking';

// ------------------------------------------------------------------ consent, per session

const listeners=new Set<()=>void>();
function consentSnapshot(){try{return sessionStorage.getItem(WALKING_CONSENT_KEY)==='yes'}catch{return false}}
function subscribeConsent(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}

/** Nothing is sent to a router until the passenger has said yes in this browsing session. */
export function useWalkingConsent(){
 const consent=useSyncExternalStore(subscribeConsent,consentSnapshot,()=>false);
 const setConsent=(value:boolean)=>{
  try{if(value)sessionStorage.setItem(WALKING_CONSENT_KEY,'yes');else sessionStorage.removeItem(WALKING_CONSENT_KEY)}catch{}
  listeners.forEach(listener=>listener());
 };
 return [consent,setConsent] as const;
}

// ------------------------------------------------------------------ the route

export type WalkStatus=
 | {status:'idle'}                                              // not asked for yet
 | {status:'problem';problem:WalkingProblem;route?:WalkingRoute} // cannot route; may keep an older route
 | {status:'loading';route?:WalkingRoute}
 | {status:'route';route:WalkingRoute};

type Result={request:RouteRequest;attempt:number;value:WalkingRoute|WalkingProblem};

const keyOf=(request:RouteRequest,attempt:number)=>`${request.stopId}|${request.from.lat},${request.from.lon}|${attempt}`;

/**
 * The walking route from your location to the chosen stop. A new route is asked for only for a
 * new stop, real movement beyond location jitter, or an explicit retry, and never more often
 * than the configured interval.
 */
export function useWalkingRoute({here,stop,config,consent,nowMs,attempt}:{
 here:(LatLon&{accuracyMetres?:number})|null;stop:{id:string;lat:number;lon:number}|null;
 config:WalkingConfig;consent:boolean;nowMs:number;attempt:number}):WalkStatus{
 const [result,setResult]=useState<Result|null>(null);
 const check=stop?preflight(here,stop,config):null;
 const current=result&&stop&&result.request.stopId===stop.id?result:null;
 const wanted=useMemo(()=>{
  if(!consent||!stop||!here||check)return null;
  const retry=current!==null&&attempt>current.attempt;
  const decision=rerouteDecision(current?.request??null,{stopId:stop.id,here,now:nowMs},config);
  return decision.go||retry?{stopId:stop.id,from:roundForRouting(here),at:nowMs}:null;
 },[consent,stop,here,check,current,attempt,nowMs,config]);
 const wantedKey=wanted?keyOf(wanted,attempt):'';

 // The request runs once per distinct request key; its inputs are read from the latest render.
 const latest=useRef({wanted,stop,config,attempt});
 useEffect(()=>{latest.current={wanted,stop,config,attempt}});
 useEffect(()=>{
  const {wanted:request,stop:target,config:settings,attempt:tries}=latest.current;
  if(!request||!target)return;
  const controller=new AbortController();
  fetchWalkingRoute(settings,request.from,{id:target.id,lat:target.lat,lon:target.lon},{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setResult({request,attempt:tries,value})});
  return()=>controller.abort();
 },[wantedKey]);

 const route=current?.value.kind==='route'?current.value:undefined;
 if(check)return {status:'problem',problem:check};
 if(!consent)return {status:'idle'};
 if(wanted&&(!current||keyOf(current.request,current.attempt)!==wantedKey))return {status:'loading',route};
 if(!current)return {status:'idle'};
 return current.value.kind==='route'?{status:'route',route:current.value}:{status:'problem',problem:current.value,route};
}
