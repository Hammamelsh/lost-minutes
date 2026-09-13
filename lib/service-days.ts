/**
 * When a timetabled pattern runs, evaluated in the browser from the rules the pipeline
 * publishes (pipeline/service_days.py is the reference; the two are tested against the same
 * cases). Used to keep a stop's service list to what actually runs today.
 *
 * Bank-holiday operation is declared in the files but not evaluated here or in the pipeline.
 */
export type OperatingRule = {
 days?:number[]; holidaysOnly?:boolean;
 alsoOn?:[string,string][]; notOn?:[string,string][];
 serviced?:{mode:'only'|'except';kind:string;organisations:string[];ranges:[string,string][]}[];
 bankHolidays?:string;
};

const LONDON_DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',
 month:'2-digit',day:'2-digit'});

/** The Manchester calendar day of a moment, as YYYY-MM-DD: the day a timetable means. */
export const londonDate=(ms:number)=>LONDON_DAY.format(ms);

/** Monday = 0, matching the pipeline and TransXChange's week order. */
export function weekdayIndex(iso:string){
 return (new Date(`${iso}T12:00:00Z`).getUTCDay()+6)%7;
}

const inside=(iso:string,ranges?:[string,string][])=>
 (ranges??[]).some(([start,end])=>start<=iso&&iso<=(end||start));

export function ruleApplies(rule:OperatingRule,iso:string):boolean{
 if(inside(iso,rule.notOn))return false;
 if(inside(iso,rule.alsoOn))return true;
 if(!(rule.days??[]).includes(weekdayIndex(iso)))return false;
 for(const serviced of rule.serviced??[]){
  const hit=inside(iso,serviced.ranges);
  if(serviced.mode==='only'&&!hit)return false;
  if(serviced.mode==='except'&&hit)return false;
 }
 return true;
}

/** true or false from the declared rules; null when a pattern carries none (unknown). */
export function runsOn(rules:OperatingRule[]|null|undefined,iso:string):boolean|null{
 if(!rules)return null;
 return rules.some(rule=>ruleApplies(rule,iso));
}
