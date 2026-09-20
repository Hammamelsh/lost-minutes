// The sky's phase from the sun's position: date and latitude in, day/dusk/night/dawn out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {daylightAt,MANCHESTER,sunTimes} from '../lib/daylight.ts';

const H=3_600_000;
const noonUtc=(y,m,d)=>Date.UTC(y,m-1,d,12);

test('at the September equinox Manchester has about twelve hours of daylight',()=>{
 const t=sunTimes(noonUtc(2026,9,22));
 assert.ok(t,'no polar day here');
 const hours=(t.set-t.rise)/H;
 assert.ok(Math.abs(hours-12.2)<0.4,`about 12 h, got ${hours.toFixed(2)}`);
 // Sunrise in September is around 06:55 BST = 05:55 UTC; sunset around 19:10 BST = 18:10 UTC.
 const rise=new Date(t.rise).getUTCHours()+new Date(t.rise).getUTCMinutes()/60;
 const set=new Date(t.set).getUTCHours()+new Date(t.set).getUTCMinutes()/60;
 assert.ok(Math.abs(rise-5.9)<0.35,`sunrise about 05:55 UTC, got ${rise.toFixed(2)}`);
 assert.ok(Math.abs(set-18.15)<0.35,`sunset about 18:10 UTC, got ${set.toFixed(2)}`);
});

test('June days are long and December days are short, at this latitude',()=>{
 const june=sunTimes(noonUtc(2026,6,21)),dec=sunTimes(noonUtc(2026,12,21));
 assert.ok((june.set-june.rise)/H>16.5,'midsummer: more than 16.5 h');
 assert.ok((dec.set-dec.rise)/H<7.8,'midwinter: under 7.8 h');
});

test('civil twilight brackets the visible sunrise and sunset',()=>{
 const at=noonUtc(2026,9,22);
 const visible=sunTimes(at,MANCHESTER,0.833),civil=sunTimes(at,MANCHESTER,6);
 assert.ok(civil.rise<visible.rise&&civil.set>visible.set);
 const dusk=(civil.set-visible.set)/60_000;
 assert.ok(dusk>25&&dusk<45,`civil dusk lasts about half an hour here in September, got ${dusk.toFixed(0)} min`);
});

test('a day runs day, dusk, night, dawn, day, with darkness rising through each twilight',()=>{
 const base=noonUtc(2026,9,22);
 const {sunriseMs,sunsetMs}=daylightAt(base);
 assert.equal(daylightAt(base).phase,'day');
 assert.equal(daylightAt(base).dark,0);
 const dusk1=daylightAt(sunsetMs+5*60_000),dusk2=daylightAt(sunsetMs+25*60_000);
 assert.equal(dusk1.phase,'dusk');assert.equal(dusk2.phase,'dusk');
 assert.ok(dusk1.dark>0&&dusk1.dark<dusk2.dark&&dusk2.dark<=1,'darker as dusk goes on');
 assert.equal(daylightAt(sunsetMs+3*H).phase,'night');
 assert.equal(daylightAt(sunsetMs+3*H).dark,1);
 const dawn=daylightAt(sunriseMs-10*60_000);
 assert.equal(dawn.phase,'dawn');
 assert.ok(dawn.dark>0&&dawn.dark<1);
 assert.equal(daylightAt(sunriseMs+60_000).phase,'day');
});

test('inside a polar circle the sky is still drawn rather than crashed',()=>{
 const d=daylightAt(noonUtc(2026,6,21),{lat:80,lon:0});
 assert.equal(d.phase,'day');
 assert.equal(d.dark,0);
});
