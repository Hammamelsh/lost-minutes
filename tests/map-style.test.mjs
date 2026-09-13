import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {baseLayers,buildingExtrusion,buildStyle,PALETTES} from '../lib/map-style.ts';
import {OVERLAY_SOURCES,overlayLayers} from '../lib/map-overlay.ts';

// MapLibre refuses a whole style over one invalid property and the page then shows the drawn
// fallback. On 13 September a data expression in symbol-placement did exactly that; these
// checks run MapLibre's own validator over everything the page will ever hand it.
for(const theme of ['day','night']){
 test(`the ${theme} style, with the City buildings and our overlay, passes MapLibre's validation`,()=>{
  const style=buildStyle(theme);
  for(const id of OVERLAY_SOURCES)style.sources[id]={type:'geojson',data:{type:'FeatureCollection',features:[]}};
  style.layers=[...style.layers,buildingExtrusion(theme),...overlayLayers(theme)];
  assert.deepEqual(validateStyleMin(style).map(error=>error.message),[]);
 });
}

test('both themes have the same layers, so switching repaints the map instead of rebuilding it',()=>{
 assert.deepEqual(baseLayers('day').map(l=>l.id),baseLayers('night').map(l=>l.id));
 assert.deepEqual(overlayLayers('day').map(l=>l.id),overlayLayers('night').map(l=>l.id));
});

test('blue, orange and lime are reserved for You, your stop and your bus, never the basemap',()=>{
 const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const reserved={you:'#5aa9e6',stop:'#ffd9a5',bus:'#c6f36a'};
 const drawnOnly=key=>!['sky','horizon','fog','light','lightIntensity'].includes(key);
 for(const [theme,palette] of Object.entries(PALETTES)){
  for(const [key,value] of Object.entries(palette).filter(([key])=>drawnOnly(key))){
   for(const [name,colour] of Object.entries(reserved)){
    const [a,b]=[rgb(value),rgb(colour)];
    const distance=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    assert.ok(distance>30,`${theme}.${key} ${value} is too close to the ${name} colour ${colour} (${distance.toFixed(0)})`);
   }
  }
 }
});
