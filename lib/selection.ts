/**
 * Which bus the passenger is following, kept apart from the bus the page would suggest.
 *
 * A suggestion is the page's pick for someone who has not chosen: the first bus coming to their
 * stop, or the latest report on a route. Those lists reorder as reports arrive, so a suggestion is
 * kept while it is still a candidate rather than re-taken from the top of the list each time.
 *
 * A pin is the passenger's own choice: a bus tapped in a list, on the card or on the map; the bus
 * shown when they start Follow or Ride along (starting either pins it); or a journey restored from
 * this device or a link. A pin names a vehicle and the journey it was on, and it is never replaced
 * by another bus:
 *   active       the vehicle is in the latest positions, on the journey it was pinned on
 *   new_journey  the same vehicle now reports another journey: said so, continued only on request
 *   absent       the vehicle is not in the latest positions: said so, with its last report if this
 *                visit saw one that has not passed the cut-off
 * New reports, list order, filters, camera gestures and theme changes do not touch it.
 */
import type {FollowBus} from '@/lib/follow';
import {savedBusOf,type SavedBus} from '@/lib/journey-context';

export type PinSource='list'|'map'|'card'|'follow'|'ride'|'device'|'link'|'continue';
/** The vehicle and the journey it was on when pinned. `journeyKnown` is false for a link that
 *  names only a vehicle: its journey is learnt the first time the vehicle is seen. */
export type Pin={bus:SavedBus;via:PinSource;journeyKnown:boolean};

export function pinOf(bus:FollowBus,via:PinSource):Pin{
 return {bus:savedBusOf(bus),via,journeyKnown:true};
}

export function pinFromKey(key:string,via:PinSource):Pin{
 const [operator='',vehicle='']=key.split('|');
 return {bus:{key,operator,vehicle,route:'',direction:'',destination:'',journeyRef:'',observedAtMs:0},
  via,journeyKnown:false};
}

/** A pin whose journey is now known from the vehicle's own report. */
export const adoptJourney=(pin:Pin,bus:FollowBus):Pin=>({...pin,bus:savedBusOf(bus),journeyKnown:true});

type JourneyIdentity={route:string;direction:string;journeyRef:string};

/** The same journey: route and direction, and the journey reference wherever both report one. */
export function sameJourney(a:JourneyIdentity,b:JourneyIdentity){
 return a.route===b.route&&a.direction===b.direction
  &&(a.journeyRef===''||b.journeyRef===''||a.journeyRef===b.journeyRef);
}

export type Selection=
 |{kind:'none'}
 |{kind:'active';pin:Pin;bus:FollowBus}
 |{kind:'new_journey';pin:Pin;bus:FollowBus}
 |{kind:'absent';pin:Pin;last:FollowBus|null};

/**
 * The pinned vehicle against the latest positions. `recall` finds the last report this visit saw
 * of a vehicle that has left the publication; one past the cut-off is not offered as a position.
 */
export function resolveSelection(pin:Pin|null,buses:FollowBus[],
                                 recall?:((key:string)=>FollowBus|null)|null):Selection{
 if(!pin)return {kind:'none'};
 const bus=buses.find(candidate=>candidate.key===pin.bus.key);
 if(!bus){
  const last=recall?.(pin.bus.key)??null;
  return {kind:'absent',pin,last:last&&last.freshness!=='expired'?last:null};
 }
 if(!pin.journeyKnown||sameJourney(pin.bus,bus))return {kind:'active',pin,bus};
 return {kind:'new_journey',pin,bus};
}

/**
 * The page's suggestion for someone who has not chosen: the previous suggestion while it is still
 * a candidate, otherwise the first candidate. A list reordering alone never changes it.
 */
export function keepSuggestion(previous:string|null,candidates:{key:string}[]):string|null{
 if(previous&&candidates.some(candidate=>candidate.key===previous))return previous;
 return candidates[0]?.key??null;
}

/** Other buses to offer instead of a pinned one that has gone or changed journey. Offered, never chosen. */
export function alternativesTo(pin:Pin|null,candidates:FollowBus[],limit=3):FollowBus[]{
 return candidates.filter(bus=>bus.key!==pin?.bus.key).slice(0,limit);
}
