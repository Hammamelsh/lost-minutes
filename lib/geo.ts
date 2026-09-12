/** Bounds-fitted equirectangular projection. Good enough at city scale, and honest:
 *  it maps a coordinate to a pixel and nothing else. No smoothing, no interpolation. */
export type Bounds = {west:number;south:number;east:number;north:number};
export type Projector = {project:(lon:number,lat:number)=>[number,number];bounds:Bounds};

const MIN_SPAN = 0.004;                     // never zoom past ~400m across
const COS = (lat:number) => Math.cos(lat*Math.PI/180);

export function boundsOf(points:{lat:number;lon:number}[],padding=0.15):Bounds|null{
 if(!points.length)return null;
 let west=points[0].lon,east=points[0].lon,south=points[0].lat,north=points[0].lat;
 for(const p of points){
  west=Math.min(west,p.lon);east=Math.max(east,p.lon);
  south=Math.min(south,p.lat);north=Math.max(north,p.lat);
 }
 const spanX=Math.max(east-west,MIN_SPAN),spanY=Math.max(north-south,MIN_SPAN);
 const cx=(west+east)/2,cy=(south+north)/2;
 return {west:cx-spanX*(0.5+padding),east:cx+spanX*(0.5+padding),
         south:cy-spanY*(0.5+padding),north:cy+spanY*(0.5+padding)};
}

/** Fit `bounds` inside a width x height box, preserving aspect so shapes are not distorted. */
export function fitProjection(bounds:Bounds,width:number,height:number):Projector{
 const cy=(bounds.south+bounds.north)/2,cos=COS(cy);
 const spanX=Math.max((bounds.east-bounds.west)*cos,1e-6);
 const spanY=Math.max(bounds.north-bounds.south,1e-6);
 const scale=Math.min(width/spanX,height/spanY);
 const cx=(bounds.west+bounds.east)/2;
 return {
  bounds,
  project:(lon:number,lat:number)=>[
   width/2+(lon-cx)*cos*scale,
   height/2-(lat-cy)*scale,
  ],
 };
}

/** Metres between two coordinates. Used only for labelling map scale, never for speed. */
export function metres(a:{lat:number;lon:number},b:{lat:number;lon:number}){
 const R=6371000,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180;
 const lat=((a.lat+b.lat)/2)*Math.PI/180;
 const x=dLon*Math.cos(lat);
 return Math.round(R*Math.sqrt(x*x+dLat*dLat));
}
