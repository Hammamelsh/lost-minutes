import {z} from 'zod';

/**
 * A stylised bus, built from a few boxes and drawn by MapLibre's own fill-extrusion layer:
 * no 3D engine, no binary asset, a parts list of about a kilobyte. The parts list is loaded
 * only when the City view or the ride-along first needs it, and if it cannot be loaded the
 * map keeps the 2D symbol.
 *
 * Geometry is placed at the bus's reported position and turned to its reported bearing. It is
 * never placed anywhere else: the camera may glide, the bus does not.
 */
const range=z.tuple([z.number(),z.number()]).refine(([a,b])=>a<b,'range must increase');
const modelSchema=z.object({
 name:z.string(),licence:z.string(),note:z.string(),
 lengthMetres:z.number().positive(),widthMetres:z.number().positive(),heightMetres:z.number().positive(),
 parts:z.array(z.object({name:z.string(),x:range,y:range,z:range,colour:z.string()})).min(1).max(60),
 colours:z.record(z.string().regex(/^#[0-9a-f]{6}$/i)),
});
export type BusModel=z.infer<typeof modelSchema>;

export const MODEL_URL='/models/lm-bus.json';

export function parseBusModel(value:unknown):BusModel{
 const model=modelSchema.parse(value);
 for(const part of model.parts)if(!model.colours[part.colour])throw Error(`No colour for ${part.name}`);
 return model;
}

type Feature={type:'Feature';geometry:{type:'Polygon';coordinates:[number,number][][]};
 /** `key` and the anchor say which bus this part belongs to and where it stands, so a tap on
  *  the drawn bus chooses it. */
 properties:{part:string;base:number;height:number;colour:string;key:string;alat:number;alon:number}};

const METRES_PER_DEGREE=111320;

/** Local metres (x across, y along the bus) to longitude/latitude, turned to `bearing`. */
function placer(lat:number,lon:number,bearing:number){
 const t=bearing*Math.PI/180,sin=Math.sin(t),cos=Math.cos(t);
 const perLon=METRES_PER_DEGREE*Math.cos(lat*Math.PI/180);
 return (x:number,y:number):[number,number]=>{
  const east=x*cos+y*sin,north=-x*sin+y*cos;
  return [lon+east/perLon,lat+north/METRES_PER_DEGREE];
 };
}

/** Another bus on the map, not the chosen one: the same shape in a muted livery, so the lime bus
 *  stays the only lime thing on the map (colours carry meaning: lime is your bus). */
export const FLEET_LIVERY:Record<string,string>={body:'#8fa3ae',stripe:'#5d7079',roof:'#c9d3d8',pod:'#b6c2c8',sign:'#d9c48a'};

/** The oriented model, when a bearing was reported. `livery` replaces the model's own colours by
 *  name (the fleet's muted one); parts it does not name keep theirs. */
export function orientedBus(model:BusModel,at:{lat:number;lon:number},bearing:number,key='',livery:Record<string,string>={}):Feature[]{
 const place=placer(at.lat,at.lon,bearing);
 const colours={...model.colours,...livery};
 return model.parts.map(part=>{
  const [x0,x1]=part.x,[y0,y1]=part.y;
  const ring=[place(x0,y0),place(x1,y0),place(x1,y1),place(x0,y1),place(x0,y0)];
  return {type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},
   // The bus this is, and where it stands: at the ride-along's zoom the model is most of the
   // screen, and a click on it is a click on that bus (`anchor` keeps the tap's distance honest
   // against a flat marker beside it).
   properties:{part:part.name,base:part.z[0],height:part.z[1],colour:colours[part.colour],
    key,alat:at.lat,alon:at.lon}};
 });
}

/** With no reported bearing there is no front to point anywhere, so the marker is a round
 *  token: the right place, and honestly no direction. */
export function unorientedToken(model:BusModel,at:{lat:number;lon:number},key=''):Feature[]{
 const place=placer(at.lat,at.lon,0);
 const circle=(radius:number)=>Array.from({length:25},(_,i)=>{
  const a=(i%24)/24*2*Math.PI;return place(radius*Math.cos(a),radius*Math.sin(a));
 });
 const colour=(name:string,fallback:string)=>model.colours[name]??fallback;
 return [
  {type:'Feature',geometry:{type:'Polygon',coordinates:[circle(2.6)]},
   properties:{part:'token',base:0,height:2.6,colour:colour('body','#c6f36a'),key,alat:at.lat,alon:at.lon}},
  {type:'Feature',geometry:{type:'Polygon',coordinates:[circle(1.6)]},
   properties:{part:'token cap',base:2.6,height:2.9,colour:colour('roof','#eef4e6'),key,alat:at.lat,alon:at.lon}},
 ];
}
