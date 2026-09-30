/**
 * Whether the ride's camera sees the chosen bus over the buildings between them, and if not, how steeply it
 * must look down to (30 September 2026).
 *
 * The outside ride frames the bus from about 49 m behind and 28 m up (zoom 20, pitch 60). Where the road
 * bends, or the bus is drawn off a road, a building can stand between the two, or the camera inside one: an
 * X43 and a V1 on the owner's phone, and an X41 at Victoria before them. Fading every building to show the
 * bus emptied the city for most of a ride in the centre (93 of 120 s on a live V1). Instead the camera rises
 * and looks more steeply down over the rooftops, just enough, and settles back once the bus is past.
 *
 * A building blocks where the sight line from the bus rises less steeply than the building's top edge seen
 * from the bus: at horizontal distance d along the ground towards the camera, a building of height h blocks if
 * h > busHeight + d·tan(e), e being the sight line's elevation. Lowering the pitch by Δ raises e by about Δ (the
 * bus keeps its place on the screen), so the steepest pitch that clears a building is
 *   pitch + e − atan((h − busHeight) / d) − margin.
 * Distances are the nearest face along three parallel lines (the bus's centre and its two sides), taken from a
 * point in the front half of the bus: a bus standing with its rear end against a low building (a stop in front of
 * a shop) is seen well enough by its front half and roof, and aiming at its middle sent the camera almost straight
 * down for a 5 m wall 1.8 m behind it (the Stretford Mall fixture, 30 September 2026).
 */
/** A building's footprint, its height, and the height its underside starts at (a bridge or overhang; 0 for most). */
export type Footprint={rings:[number,number][][];height:number;base?:number};
export type SightInput={bus:{lon:number;lat:number;heading?:number|null};camera:{lon:number;lat:number;altitude:number};
 pitch:number;footprints:Footprint[]};
export type Sight={
 /** The steepest pitch at which no footprint blocks the bus, or null where none constrains it. */
 cap:number|null;
 /** The bus stands inside a footprint taller than the part of it that must be seen: no pitch clears it. */
 inside:boolean;
 /** Footprints that constrain the pitch, for the record and for remembering. */
 blocking:number[];
 /** The footprint that sets the cap: its nearest face along the sight line (m) and its height (m). */
 binding:{distance:number;height:number;index:number}|null;
};

export const SIGHT={
 /** From what height (m) the bus must be seen over what stands behind it: its upper body and roof. */
 busHeight:2.0,
 /** How far ahead of its centre (m), along its heading, the part that must be seen lies: its front half. */
 lookAhead:3,
 /** Its half-width (m): the sight lines to both sides must clear too. */
 halfWidth:1.3,
 /** Clearance above a building's edge, in degrees. */
 marginDeg:2,
 /** A structure whose underside is above this (m), a bus's height, stands over the bus rather than around it. */
 overhead:3.3,
};

const M_PER_DEG=111195;

/** Where each footprint's nearest face crosses the sight line, and whether the bus is inside it. */
export function sightline({bus,camera,pitch,footprints}:SightInput):Sight{
 const kx=M_PER_DEG*Math.cos(bus.lat*Math.PI/180);
 // Metres east and north of the part of the bus that must be seen; the bus's centre stays the test of "inside".
 const h=bus.heading===null||bus.heading===undefined?null:bus.heading*Math.PI/180;
 const [tx,ty]=h===null?[0,0]:[Math.sin(h)*SIGHT.lookAhead,Math.cos(h)*SIGHT.lookAhead];
 const local=([lon,lat]:[number,number]):[number,number]=>[(lon-bus.lon)*kx-tx,(lat-bus.lat)*M_PER_DEG-ty];
 const [cx,cy]=local([camera.lon,camera.lat]);
 const ground=Math.hypot(cx,cy);
 const blocking:number[]=[];
 let cap:number|null=null,inside=false,binding:Sight['binding']=null;
 const toCamera:[number,number]|null=ground>0.5?[cx/ground,cy/ground]:null;
 const across:[number,number]|null=toCamera?[-toCamera[1],toCamera[0]]:null;
 const eNow=Math.atan2(camera.altitude-SIGHT.busHeight,Math.max(ground,0.01))*180/Math.PI;
 const reach=Math.hypot(ground,camera.altitude)*1.05;
 footprints.forEach((f,index)=>{
  if(!(f.height>SIGHT.busHeight))return;
  const base=f.base??0;
  const rings=f.rings.map(r=>r.map(local));
  // Inside: the bus's centre, even-odd over every ring, so a merged multi-polygon's holes and parts both count.
  let crossings=0;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const [xi,yi]=ring[i],[xj,yj]=ring[j];
   if((yi>-ty)!==(yj>-ty)&&-tx<(xj-xi)*(-ty-yi)/(yj-yi)+xi)crossings++;
  }
  if(crossings%2===1&&base<SIGHT.overhead){inside=true;blocking.push(index);return}
  if(!toCamera||!across)return;
  let nearest=Infinity;
  for(const offset of [-SIGHT.halfWidth,0,SIGHT.halfWidth]){
   const ox=across[0]*offset,oy=across[1]*offset;
   for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,ay]=ring[j],[bx,by]=ring[i];
    const ex=bx-ax,ey=by-ay,den=toCamera[0]*ey-toCamera[1]*ex;
    if(Math.abs(den)<1e-9)continue;
    const d=((ax-ox)*ey-(ay-oy)*ex)/den,s=((ax-ox)*toCamera[1]-(ay-oy)*toCamera[0])/den;
    if(s>=0&&s<=1&&d>0.5&&d<reach&&d<nearest)nearest=d;
   }
  }
  if(!Number.isFinite(nearest))return;
  // A raised structure the sight line passes beneath, as it stands, hides nothing.
  if(base>0&&SIGHT.busHeight+nearest*Math.tan(eNow*Math.PI/180)<base)return;
  const eNeeded=Math.atan2(f.height-SIGHT.busHeight,nearest)*180/Math.PI;
  const allowed=pitch+eNow-eNeeded-SIGHT.marginDeg;
  if(allowed<pitch+SIGHT.marginDeg){blocking.push(index)}
  if(cap===null||allowed<cap){cap=allowed;binding={distance:nearest,height:f.height,index}}
 });
 return {cap,inside,blocking,binding};
}
