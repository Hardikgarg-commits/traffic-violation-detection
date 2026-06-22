const fs=require('fs'), path=require('path');
const DATA=path.join(__dirname,'..','data','incidents.json');
const FRAME_DATA=path.join(__dirname,'..','data','incoming_frames.json');
const incidents=[];
const frames=[];
function normalizeIncident(x){
 if (typeof x.readiness !== 'number') {
  let score=20;
  if (x.type && x.type !== 'No violation confirmed') score += 25;
  if ((x.confidence||0) >= 80) score += 18; else if ((x.confidence||0) >= 60) score += 10;
  if (x.plate && x.plate !== 'Not readable') score += 18;
  if (x.location && !String(x.location).startsWith('Unknown')) score += 10;
  x.readiness=Math.max(0,Math.min(100,Math.round(score)));
 }
 x.readinessLabel ||= x.readiness>=75?'Challan-ready after review':x.readiness>=50?'Needs reviewer validation':'Evidence weak';
 x.aiJudge ||= x.readiness>=75?'Likely enforceable after human approval':x.readiness>=50?'Needs review before enforcement':'Do not auto-enforce';
 x.aiDecision ||= x.readiness>=70 && x.type !== 'No violation confirmed' ? 'AI approved' : 'AI rejected';
 if (typeof x.location === 'string' && /Analyze Traffic Evidence|Drishti Detects|Upload A Roadside/i.test(x.location)) {
  x.location='Unknown — no GPS/camera metadata';
  x.metadataSource={...(x.metadataSource||{}),location:'cleaned_legacy_ui_text'};
 }
 if (x.location === 'Kr Circle, Begaluru') x.location='KR Circle, Bengaluru';
 if (x.objectCounts && x.objectCounts['person without seat belt']) delete x.objectCounts['person without seat belt'];
 if (Array.isArray(x.reasoning)) x.reasoning=x.reasoning.filter(r=>!/person without seat belt|seatbelt/i.test(r));
 x.reasoning ||= [`Legacy evidence record ${x.id}.`, `${x.type} confidence: ${x.confidence||0}%.`, `Plate status: ${x.plate||'Unknown'}.`];
 x.review ||= { note:'', by:'', at:null };
 return x;
}
try { incidents.push(...JSON.parse(fs.readFileSync(DATA,'utf8')).map(normalizeIncident)) } catch {}
try { frames.push(...JSON.parse(fs.readFileSync(FRAME_DATA,'utf8'))) } catch {}
function save(){ fs.mkdirSync(path.dirname(DATA),{recursive:true}); fs.writeFileSync(DATA,JSON.stringify(incidents,null,2)); fs.writeFileSync(FRAME_DATA,JSON.stringify(frames,null,2)) }
function analytics(rows){
 const counts={}; rows.forEach(x=>counts[x.type]=(counts[x.type]||0)+1);
 const today=new Date().toDateString();
 const readinessRows=rows.filter(x=>typeof x.readiness==='number');
 const approved=rows.filter(x=>x.status==='Approved').length;
 const rejected=rows.filter(x=>x.status==='Rejected'||x.status==='Cancelled').length;
 const reviewed=approved+rejected;
 const reviewPrecision=reviewed?Math.round(approved/reviewed*100):null;
 const withPlate=rows.filter(x=>x.plate && x.plate!=='Not readable').length;
 const autoApproved=rows.filter(x=>x.status==='AI approved').length;
 const autoRejected=rows.filter(x=>x.status==='AI rejected').length;
 const statusBreakdown=Object.entries(rows.reduce((acc,x)=>{acc[x.status||'Unknown']=(acc[x.status||'Unknown']||0)+1;return acc},{})).map(([name,value])=>({name,value}));
 const vehicles=Object.entries(rows.reduce((acc,x)=>{const k=x.vehicle||'Not classified';acc[k]=(acc[k]||0)+1;return acc},{})).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,value])=>({name,value}));
 const avgConfidence=rows.length?Math.round(rows.reduce((s,x)=>s+Number(x.confidence||0),0)/rows.length):null;
 return { total:rows.length, today:rows.filter(x=>new Date(x.timestamp).toDateString()===today).length, accuracy:null,
  reviewQueue:rows.filter(x=>!['Approved','Rejected','Cancelled'].includes(x.status)).length,
  approved,rejected,cancelled:rows.filter(x=>x.status==='Cancelled').length,reviewPrecision,
  autoApproved,autoRejected,statusBreakdown,vehicles,avgConfidence,
  plateReadable:rows.length?Math.round(withPlate/rows.length*100):null, unreadablePlates:rows.length-withPlate,
  avgReadiness:readinessRows.length?Math.round(readinessRows.reduce((s,x)=>s+x.readiness,0)/readinessRows.length):null,
  byType:Object.entries(counts).map(([name,value])=>({name,value})),
  hourly:Array.from({length:12},(_,i)=>rows.filter(x=>Math.floor(new Date(x.timestamp).getHours()/2)===i).length),
  cameras:{online:23,total:24}, trend:null,
  hotspots:Object.values(rows.reduce((acc,x)=>{
    const key=x.camera?.id||x.location||'Unknown';
    acc[key] ||= { id:key, name:x.camera?.name||x.location||'Unknown', value:0, lat:x.camera?.lat, lng:x.camera?.lng };
    acc[key].value += 1;
    return acc;
  },{})).sort((a,b)=>b.value-a.value).slice(0,5) };
}
module.exports={incidents,frames,analytics,save};
