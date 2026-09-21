// Finding a place to start from or go to: a bus stop of ours, a UK postcode, or an address or
// landmark from OpenStreetMap. Each result carries enough to tell it from its namesakes (street,
// district, postcode), and nothing is chosen for the passenger: a list is shown, one is picked.
//
// Providers, checked on 21 September 2026: postcodes.io (free, MIT, no key; CORS open) for
// postcodes, and Photon by komoot (free public instance, "please be fair — extensive usage will
// be throttled", no availability guarantee, no key; CORS open; attribution to OpenStreetMap).
// Both are asked from the browser, only when the passenger types, bounded to Greater Manchester.
import {searchStops,type Stop} from '@/lib/stops';

export type Place={
 kind:'stop'|'postcode'|'address';
 label:string;          // what the passenger picked: "Stretford Mall (Stop A)", "M32 8LZ", "Old Trafford"
 detail:string;         // what tells it from its namesakes
 lat:number;lon:number;
 source:'stops'|'postcodes.io'|'photon';
 stopId?:string;
};

/** Greater Manchester, generously: what the two providers are asked to stay inside. */
export const PLACE_BBOX={west:-2.75,south:53.30,east:-1.90,north:53.70};

const POSTCODE=/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const PARTIAL_POSTCODE=/^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{0,2})?$/i;
export const looksLikePostcode=(q:string)=>POSTCODE.test(q.trim());
export const looksLikePartialPostcode=(q:string)=>PARTIAL_POSTCODE.test(q.trim())&&!POSTCODE.test(q.trim());

export const inside=(p:{lat:number;lon:number})=>p.lat>=PLACE_BBOX.south&&p.lat<=PLACE_BBOX.north&&p.lon>=PLACE_BBOX.west&&p.lon<=PLACE_BBOX.east;

/** Our own stops, as places: exact enough to board at. */
export function stopPlaces(stops:Stop[],query:string,limit=4):Place[]{
 return searchStops(stops,query,limit).map(({stop})=>({kind:'stop',stopId:stop.id,
  label:stop.indicator?`${stop.name} (${stop.indicator})`:stop.name,
  detail:['Bus stop',stop.street,stop.locality??stop.parentLocality].filter(Boolean).join(' · '),
  lat:stop.lat,lon:stop.lon,source:'stops'}));
}

type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;

/** A postcode, or postcodes that begin with what was typed, from postcodes.io. */
export async function postcodePlaces(query:string,{fetch:f=fetch,signal}:{fetch?:Fetch;signal?:AbortSignal}={}):Promise<Place[]>{
 const q=query.trim().toUpperCase();
 if(!looksLikePostcode(q)&&!looksLikePartialPostcode(q))return [];
 const out:Place[]=[];
 const read=(r:{postcode:string;latitude:number|null;longitude:number|null;admin_district?:string|null;admin_ward?:string|null;region?:string|null})=>{
  if(typeof r.latitude!=='number'||typeof r.longitude!=='number')return;
  const p={lat:r.latitude,lon:r.longitude};
  if(!inside(p))return;
  out.push({kind:'postcode',label:r.postcode,detail:['Postcode',r.admin_ward,r.admin_district].filter(Boolean).join(' · '),...p,source:'postcodes.io'});
 };
 try{
  if(looksLikePostcode(q)){
   const r=await f(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`,{signal});
   if(r.ok){const j=await r.json();if(j?.result)read(j.result)}
  }else{
   const r=await f(`https://api.postcodes.io/postcodes?q=${encodeURIComponent(q)}&limit=5`,{signal});
   if(r.ok){const j=await r.json();for(const item of j?.result??[])read(item)}
  }
 }catch{/* the provider is optional: no result is not an error the passenger has to read */}
 return out;
}

/** Addresses and landmarks from OpenStreetMap, via Photon, biased to and bounded by Greater Manchester. */
export async function addressPlaces(query:string,{fetch:f=fetch,signal,near}:{fetch?:Fetch;signal?:AbortSignal;near?:{lat:number;lon:number}}={}):Promise<Place[]>{
 const q=query.trim();
 if(q.length<3)return [];
 const bias=near??{lat:53.48,lon:-2.24};
 const url=`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${bias.lat}&lon=${bias.lon}&limit=6&lang=en`
  +`&bbox=${PLACE_BBOX.west},${PLACE_BBOX.south},${PLACE_BBOX.east},${PLACE_BBOX.north}`;
 try{
  const r=await f(url,{signal});
  if(!r.ok)return [];
  const j=await r.json();
  const seen=new Set<string>();const out:Place[]=[];
  for(const feature of j?.features??[]){
   const pr=feature?.properties??{},c=feature?.geometry?.coordinates;
   if(!Array.isArray(c)||typeof c[0]!=='number'||typeof c[1]!=='number')continue;
   const p={lat:c[1],lon:c[0]};
   if(!inside(p))continue;
   // A bus stop from OSM is not one of ours to board at; our catalogue lists those with sides.
   if(pr.osm_value==='bus_stop')continue;
   const name=pr.name??[pr.housenumber,pr.street].filter(Boolean).join(' ');
   if(!name)continue;
   const detail=[pr.osm_value&&pr.osm_value!=='yes'?String(pr.osm_value).replace(/_/g,' '):null,
    pr.street&&pr.name?pr.street:null,pr.district,pr.city,pr.postcode].filter(Boolean).join(' · ');
   const key=`${name}|${detail}`;
   if(seen.has(key))continue;seen.add(key);
   out.push({kind:'address',label:name,detail:detail||'OpenStreetMap',...p,source:'photon'});
  }
  return out;
 }catch{return []}
}

/** Everything for one query: our stops first (they can be boarded at), then a postcode, then
 *  addresses and landmarks. The caller shows the list; nothing here picks. */
export async function searchPlaces(query:string,stops:Stop[],options:{fetch?:Fetch;signal?:AbortSignal;near?:{lat:number;lon:number}}={}):Promise<Place[]>{
 const q=query.trim();
 if(!q)return [];
 const [postcodes,addresses]=await Promise.all([postcodePlaces(q,options),addressPlaces(q,options)]);
 return [...stopPlaces(stops,q),...postcodes,...addresses];
}

export const PLACES_ATTRIBUTION='Places: © OpenStreetMap contributors via Photon (komoot); postcodes: postcodes.io.';
