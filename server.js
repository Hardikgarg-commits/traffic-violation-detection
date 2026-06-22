const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { incidents, frames, analytics, save } = require('./src/store');
const { mapConfig, knownCameraLocations, authStatus } = require('./src/mapmyindia');

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
const AI_PORT = Number(process.env.AI_PORT || 8001);
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png' };
const INCOMING_DIR = path.join(__dirname, 'data', 'incoming_frames');
const DEMO_FRAMES_DIR = path.join(__dirname, 'data', 'demo_frames');
const INGESTION_AUTO = process.env.DRISHTI_INGESTION_AUTO !== '0';
const INGESTION_INTERVAL_MS = Number(process.env.DRISHTI_INGESTION_INTERVAL_MS || 5000);
let demoReplayIndex = 0;

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'*' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw='';
    req.on('data', c => { raw += c; if (raw.length > 12_000_000) reject(new Error('Image exceeds 8 MB limit')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON payload')); } });
    req.on('error', reject);
  });
}

function postAI(payload) {
  return new Promise((resolve, reject) => {
    const raw=JSON.stringify(payload);
    const r=http.request({hostname:'127.0.0.1',port:AI_PORT,path:'/analyze',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}}, resp=>{
      let out=''; resp.on('data',c=>out+=c); resp.on('end',()=>{try{const parsed=JSON.parse(out);resp.statusCode>=400?reject(new Error(parsed.error||'AI analysis failed')):resolve(parsed)}catch{reject(new Error('Invalid response from AI service'))}})
    });
    r.setTimeout(180000,()=>r.destroy(new Error('AI analysis timed out'))); r.on('error',reject); r.end(raw);
  });
}

function cameraFor(location='') {
  const needle=String(location).toLowerCase();
  const cameras=knownCameraLocations();
  return cameras.find(c => needle.includes('mg') || needle.includes('kr circle') || needle.includes('bengaluru') || needle.includes('bangalore')) || null;
}

function buildReasoning(result) {
  const x=result.incident, readable=x.plate && x.plate !== 'Not readable';
  const detected=Object.entries(result.objectCounts||{}).filter(([k])=>!k.includes('seat belt')).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${v} ${k}`);
  const rules=(result.violations||[]).map(v=>`${v.type}: ${v.basis} (${v.confidence}%)`);
  return [
    `Detected ${result.detections?.length||0} visual objects with ${result.model?.detector||'YOLO'} and OCR via ${result.model?.ocr||'OCR'}.`,
    detected.length?`Scene summary: ${detected.join(', ')}.`:'No high-confidence road users were found.',
    rules.length?`Violation trigger: ${rules[0]}.`:'No enforceable violation was confirmed from this single frame.',
    x.challanReason?`Challan reason: ${x.challanReason}.`:'Challan reason is unavailable.',
    readable?`Registration read as ${x.plate}.`:'Registration plate is not readable enough for automatic challan.',
    x.location?.startsWith('Unknown')?'Location is missing, so map evidence requires camera metadata.':`Location metadata supplied from ${x.metadataSource?.location||'input'}: ${x.location}.`,
    (result.notEvaluated||[]).length?`${result.notEvaluated.length} temporal/calibrated rules were intentionally not evaluated.`:'All configured rules were evaluated.'
  ];
}

function readiness(result) {
  const x=result.incident;
  let score=20;
  if (x.type && x.type !== 'No violation confirmed') score += 25;
  if (x.confidence >= 80) score += 18; else if (x.confidence >= 60) score += 10;
  if (x.plate && x.plate !== 'Not readable') score += 18;
  if (x.location && !x.location.startsWith('Unknown')) score += 10;
  if ((result.detections||[]).length >= 5) score += 5;
  if ((result.quality?.warnings||[]).length) score -= 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const AUTO_APPROVE_THRESHOLD = Number(process.env.DRISHTI_AUTO_APPROVE_THRESHOLD || 70);

function shaFile(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function frameStats() {
  const counts=frames.reduce((acc,x)=>{acc[x.status||'queued']=(acc[x.status||'queued']||0)+1;return acc},{});
  return {
    total:frames.length,
    queued:counts.queued||0,
    processing:counts.processing||0,
    processed:counts.processed||0,
    failed:counts.failed||0,
    last:frames[0]||null
  };
}

function enqueueFrame({ imagePath, cameraId='CAM-04', capturedAt, location, source='folder-watch' }) {
  const absolute=path.resolve(imagePath);
  const allowedRoot=path.resolve(INCOMING_DIR);
  if (!absolute.startsWith(allowedRoot) && !absolute.startsWith(path.resolve(__dirname))) throw new Error('Frame path is outside the project workspace');
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error('Frame image not found');
  const ext=path.extname(absolute).toLowerCase();
  if (!['.jpg','.jpeg','.png','.webp'].includes(ext)) throw new Error('Only JPG, PNG and WEBP frames are supported');
  const hash=shaFile(absolute);
  const existing=frames.find(x=>path.resolve(x.imagePath||'')===absolute);
  if (existing) return existing;
  const camera=cameraFor(location || cameraId);
  const frame={
    id:'FR-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),
    cameraId,
    cameraName:camera?.name || location || cameraId,
    location:location || camera?.name || 'Unknown — camera metadata pending',
    imagePath:absolute,
    filename:path.basename(absolute),
    hash,
    capturedAt:capturedAt || new Date().toISOString(),
    receivedAt:new Date().toISOString(),
    processed:false,
    status:'queued',
    source,
    generatedIncidents:[],
    error:null
  };
  frames.unshift(frame);
  save();
  return frame;
}

function scanIncomingFolder() {
  fs.mkdirSync(INCOMING_DIR,{recursive:true});
  const added=[];
  for (const name of fs.readdirSync(INCOMING_DIR)) {
    const file=path.join(INCOMING_DIR,name);
    if (!fs.statSync(file).isFile()) continue;
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
    const before=frames.length;
    const frame=enqueueFrame({ imagePath:file, cameraId:'CAM-04', location:'KR Circle, Bengaluru' });
    if (frames.length>before) added.push(frame);
  }
  return added;
}

function replayDemoFrames(count=1) {
  fs.mkdirSync(DEMO_FRAMES_DIR,{recursive:true});
  fs.mkdirSync(INCOMING_DIR,{recursive:true});
  const demo=fs.readdirSync(DEMO_FRAMES_DIR)
    .filter(name=>/\.(jpe?g|png|webp)$/i.test(name))
    .sort()
    .map(name=>path.join(DEMO_FRAMES_DIR,name));
  if (!demo.length) return { copied:0, remaining:0, message:'No demo frames found in data/demo_frames' };
  const copied=[];
  for (let i=0; i<count; i++) {
    const src=demo[demoReplayIndex % demo.length];
    demoReplayIndex += 1;
    const ext=path.extname(src).toLowerCase();
    const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
    const dest=path.join(INCOMING_DIR,`CAM04-demo-${stamp}-${String(demoReplayIndex).padStart(3,'0')}${ext}`);
    fs.copyFileSync(src,dest);
    copied.push(enqueueFrame({ imagePath:dest, cameraId:'CAM-04', location:'KR Circle, Bengaluru', source:'demo-replay' }));
  }
  return { copied:copied.length, remaining:Math.max(0,demo.length-(demoReplayIndex%demo.length)), frames:copied };
}

function imageDataUrl(file) {
  const ext=path.extname(file).toLowerCase();
  const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

let ingestionBusy=false;
async function processOneFrame() {
  if (ingestionBusy) return null;
  const frame=frames.find(x=>!x.processed && x.status!=='processing');
  if (!frame) return null;
  ingestionBusy=true;
  frame.status='processing'; frame.startedAt=new Date().toISOString(); frame.error=null; save();
  try {
    const result=enrichResult(await postAI({
      name:frame.filename,
      image:imageDataUrl(frame.imagePath),
      location:frame.location,
      capturedAt:frame.capturedAt
    }));
    const rows=(result.incidents||[result.incident]).map(x=>({
      ...x,
      id:`${frame.id}-${x.id}`,
      frameId:frame.id,
      cameraId:frame.cameraId,
      source:'live-ingestion',
      sourceImage:undefined,
      annotatedImage:undefined,
      targetImage:undefined
    }));
    const existingKeys=new Set(incidents.map(x=>`${x.frameId}|${x.type}|${x.subjectId||x.challanReason}`));
    const fresh=rows.filter(x=>!existingKeys.has(`${x.frameId}|${x.type}|${x.subjectId||x.challanReason}`));
    incidents.unshift(...fresh);
    frame.processed=true;
    frame.status='processed';
    frame.processedAt=new Date().toISOString();
    frame.generatedIncidents=fresh.map(x=>x.id);
    frame.detections=result.detections?.length||0;
    frame.violations=fresh.length;
    save();
    return frame;
  } catch (err) {
    frame.status='failed';
    frame.error=err.message;
    frame.processed=false;
    frame.processedAt=new Date().toISOString();
    save();
    return frame;
  } finally {
    ingestionBusy=false;
  }
}

function enrichResult(result) {
  const camera=cameraFor(result.incident.location);
  const base=result.incident||{};
  const violations=(result.violations||[]).length?result.violations:[{
    type:base.type||'No violation confirmed',
    confidence:base.confidence||0,
    box:base.targetBox,
    basis:base.challanReason||'No enforceable violation was confirmed',
    targetImage:base.targetImage,
    targetBox:base.targetBox,
    targetEvidence:base.evidence?.target,
    subjectId:`${base.id||'DR'}-S01`
  }];
  result.incidents=violations.map((v,index)=>{
    const incident={
      ...base,
      id:index===0?base.id:`${base.id}-${String(index+1).padStart(2,'0')}`,
      subjectId:v.subjectId||`${base.id}-S${String(index+1).padStart(2,'0')}`,
      type:v.type||base.type,
      confidence:Math.round(Number(v.confidence||base.confidence||0)),
      challanReason:v.basis||base.challanReason,
      targetImage:v.targetImage||base.targetImage,
      targetBox:v.targetBox||base.targetBox,
      evidence:{...(base.evidence||{}), target:v.targetEvidence||base.evidence?.target}
    };
    const scoped={...result, incident, violations:[v]};
    const score=readiness(scoped);
    const enforceable=incident.type && incident.type !== 'No violation confirmed';
    const aiDecision=enforceable && score >= AUTO_APPROVE_THRESHOLD ? 'AI approved' : 'AI rejected';
    return {...incident,
      readiness:score,
      readinessLabel:score>=AUTO_APPROVE_THRESHOLD?'Above AI threshold':'Below AI threshold',
      aiJudge:aiDecision==='AI approved'?'AI recommends approval; human may override':'AI recommends cancellation/rejection; human may override',
      aiDecision,
      decisionThreshold:AUTO_APPROVE_THRESHOLD,
      status:aiDecision,
      reasoning:buildReasoning(scoped),
      quality:result.quality,
      objectCounts:result.objectCounts,
      notEvaluated:result.notEvaluated,
      stamp:result.stamp,
      detectionsCount:result.detections?.length||0,
      model:result.model,
      pipeline:result.pipeline,
      camera:camera?{...camera, confidence:'configured-sample'}:null,
      review:{ note:'', by:'', at:null }
    };
  });
  result.incident=result.incidents[0];
  return result;
}

function safeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function dossierHtml(x) {
  const annotated=x.evidence?.annotated?`/evidence/${path.basename(x.evidence.annotated)}`:'';
  const target=x.evidence?.target?`/evidence/${path.basename(x.evidence.target)}`:'';
  const bullets=(x.reasoning||[]).map(r=>`<li>${safeHtml(r)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeHtml(x.id)} Evidence Dossier</title><style>
  body{font-family:Arial,sans-serif;background:#f4f3ef;color:#172229;margin:0;padding:28px}.sheet{max-width:980px;margin:auto;background:white;border:1px solid #ddd;border-radius:18px;overflow:hidden}.top{background:#172229;color:white;padding:28px;display:flex;justify-content:space-between}.top b{color:#d9ff62}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:22px;padding:24px}.photo{background:#111;border-radius:14px;overflow:hidden;margin-bottom:12px}.photo img{width:100%;display:block}.target{display:grid;grid-template-columns:.8fr 1fr;gap:12px}.target img{width:100%;border-radius:12px;background:#111}.card{background:#f6f7f2;border-radius:14px;padding:16px;margin-bottom:12px}.score{font-size:46px;font-weight:800;color:#41a676}.tag{display:inline-block;background:#fff0ec;color:#c34e36;border-radius:999px;padding:7px 10px;font-size:12px}.reason li{margin:8px 0;font-size:13px;line-height:1.4}.foot{padding:18px 24px;border-top:1px solid #eee;font-size:12px;color:#6f7c82}@media print{button{display:none}body{background:white;padding:0}.sheet{border:0}}</style></head><body><div class="sheet"><div class="top"><div><h1>AI Evidence Dossier</h1><p>${safeHtml(x.id)} · ${safeHtml(x.timestamp)}</p></div><div><b>${safeHtml(x.aiJudge)}</b><p>${safeHtml(x.status)}</p><button onclick="print()">Download / Print PDF</button></div></div><div class="grid"><div><div class="photo">${annotated?`<img src="${annotated}" alt="Full annotated scene">`:'No annotated image stored'}</div>${target?`<div class="card target"><img src="${target}" alt="Cropped challan subject"><div><h3>Challan subject crop</h3><p>This crop helps the reviewer identify the specific rider/vehicle inside a crowded scene.</p></div></div>`:''}<div class="card"><h3>Explainable AI reasoning</h3><ul class="reason">${bullets}</ul></div></div><aside><div class="card"><span class="tag">${safeHtml(x.type)}</span><h2>${safeHtml(x.plate)}</h2><p>${safeHtml(x.vehicle)} · ${safeHtml(x.location)}</p></div><div class="card"><h3>Challan reason</h3><p>${safeHtml(x.challanReason||'Reason unavailable')}</p><small>Location source: ${safeHtml(x.metadataSource?.location||'unknown')}</small></div><div class="card"><div class="score">${safeHtml(x.readiness)}/100</div><b>${safeHtml(x.readinessLabel)}</b><p>Threshold: ${safeHtml(x.decisionThreshold||70)}/100</p></div><div class="card"><h3>Model proof</h3><p>${safeHtml(x.model?.detector)}<br>${safeHtml(x.model?.ocr)}</p></div><div class="card"><h3>Review</h3><p>${safeHtml(x.review?.note||'Pending optional human verification')}</p></div></aside></div><div class="foot">Drishti AI uses local CV inference and does not fabricate unreadable plates, unknown locations, or evaluation metrics.</div></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { status:'ok', service:'Drishti AI', model:'yolov8s-worldv2 + EasyOCR', genuineInference:true, mapProvider:mapConfig().enabled?'MapmyIndia / Mappls':'not configured', mapRestApisReady:authStatus().restApisReady });
    }
    if (url.pathname === '/api/map/config' && req.method === 'GET') return send(res, 200, mapConfig());
    if (url.pathname === '/api/map/cameras' && req.method === 'GET') return send(res, 200, { cameras:knownCameraLocations() });
    if (url.pathname === '/api/map/auth-status' && req.method === 'GET') return send(res, 200, authStatus());
    if (url.pathname === '/api/hotspots' && req.method === 'GET') return send(res, 200, { hotspots:analytics(incidents).hotspots });
    if (url.pathname === '/api/ingestion' && req.method === 'GET') {
      return send(res, 200, { status:frameStats(), frames:frames.slice(0,30), incomingDir:INCOMING_DIR, auto:INGESTION_AUTO, busy:ingestionBusy });
    }
    if (url.pathname === '/api/ingestion/scan' && req.method === 'POST') {
      const added=scanIncomingFolder();
      return send(res, 200, { added:added.length, status:frameStats(), frames:frames.slice(0,30), incomingDir:INCOMING_DIR });
    }
    if (url.pathname === '/api/ingestion/replay-demo' && req.method === 'POST') {
      const payload=await body(req);
      const replay=replayDemoFrames(Math.max(1, Math.min(20, Number(payload.count||1))));
      return send(res, 200, { ...replay, status:frameStats(), frames:frames.slice(0,30), incomingDir:INCOMING_DIR });
    }
    if (url.pathname === '/api/ingestion/enqueue' && req.method === 'POST') {
      const payload=await body(req);
      const frame=enqueueFrame({ imagePath:payload.imagePath, cameraId:payload.cameraId, capturedAt:payload.capturedAt, location:payload.location, source:'api' });
      return send(res, 200, { frame, status:frameStats() });
    }
    if (url.pathname === '/api/ingestion/process' && req.method === 'POST') {
      scanIncomingFolder();
      const frame=await processOneFrame();
      return send(res, 200, { frame, status:frameStats(), frames:frames.slice(0,30) });
    }
    const reviewMatch=url.pathname.match(/^\/api\/incidents\/([^/]+)\/review$/);
    if (reviewMatch && req.method === 'PATCH') {
      const payload=await body(req), item=incidents.find(x=>x.id===decodeURIComponent(reviewMatch[1]));
      if (!item) return send(res, 404, { error:'Incident not found' });
      item.status=payload.status || item.status;
      if (payload.plate) item.plate=String(payload.plate).trim().toUpperCase();
      item.review={ note:payload.note || '', by:payload.by || 'Human reviewer', at:new Date().toISOString() };
      save();
      return send(res, 200, { incident:item });
    }
    const dossierMatch=url.pathname.match(/^\/api\/incidents\/([^/]+)\/dossier$/);
    if (dossierMatch && req.method === 'GET') {
      const item=incidents.find(x=>x.id===decodeURIComponent(dossierMatch[1]));
      if (!item) return send(res, 404, { error:'Incident not found' });
      return send(res, 200, dossierHtml(item), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/incidents' && req.method === 'GET') {
      const q=(url.searchParams.get('q')||'').toLowerCase();
      const type=url.searchParams.get('type')||'all';
      const rows=incidents.filter(x => (type==='all'||x.type===type) && (!q||`${x.plate} ${x.type} ${x.location}`.toLowerCase().includes(q)));
      return send(res, 200, { incidents:rows, total:rows.length });
    }
    if (url.pathname === '/api/analytics') return send(res, 200, analytics(incidents));
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const payload=await body(req);
      if (!payload.image || !payload.name) return send(res, 400, { error:'Image and filename are required' });
      const result=enrichResult(await postAI(payload));
      const rows=(result.incidents||[result.incident]).map(x=>({...x,sourceImage:undefined,annotatedImage:undefined,targetImage:undefined}));
      incidents.unshift(...rows);
      save();
      return send(res, 200, result);
    }
    if (url.pathname === '/api/export') {
      const header='Incident ID,Timestamp,Violation,Plate,Confidence,Readiness,Location,Status\n';
      const csv=header+incidents.map(x=>[x.id,x.timestamp,x.type,x.plate,x.confidence,x.readiness,x.location,x.status].map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
      return send(res, 200, csv, 'text/csv; charset=utf-8');
    }
    if (url.pathname.startsWith('/evidence/')) {
      const evidenceRoot=path.join(__dirname,'data','evidence');
      const file=path.normalize(path.join(evidenceRoot, path.basename(url.pathname)));
      if (!file.startsWith(evidenceRoot)) return send(res,403,{error:'Forbidden'});
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res,200,fs.readFileSync(file),MIME[path.extname(file)]||'application/octet-stream');
      return send(res,404,{error:'Evidence not found'});
    }
    const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const file=path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res,403,{error:'Forbidden'});
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res,200,fs.readFileSync(file),MIME[path.extname(file)]||'application/octet-stream');
    send(res,404,{error:'Not found'});
  } catch (err) { send(res, err.message.includes('8 MB')?413:500, { error:err.message }); }
});

let aiProcess;
let ingestionTimer;
function ensureAIService(){
  const probe=http.get({hostname:'127.0.0.1',port:AI_PORT,path:'/health',timeout:1000},r=>{r.resume();console.log('Genuine AI service already online')});
  probe.on('timeout',()=>probe.destroy());
  probe.on('error',()=>{
    const localPython=path.join(__dirname,'.venv','Scripts','python.exe');
    const python=process.env.PYTHON || (fs.existsSync(localPython)?localPython:'python');
    aiProcess=spawn(python,['-u','ai_service.py'],{cwd:__dirname,env:{...process.env,AI_PORT:String(AI_PORT)},stdio:'inherit'});
    aiProcess.on('error',()=>console.warn('AI environment missing. Run: npm run setup:ai'));
    aiProcess.on('exit',code=>console.error(`AI service stopped (${code})`));
  });
}
if (require.main === module) {
  ensureAIService();
  fs.mkdirSync(INCOMING_DIR,{recursive:true});
  if (INGESTION_AUTO) ingestionTimer=setInterval(()=>{ scanIncomingFolder(); processOneFrame().catch(err=>console.error('Ingestion worker failed',err)); }, INGESTION_INTERVAL_MS);
  server.listen(PORT, () => console.log(`Drishti AI running at http://localhost:${PORT}`));
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{if(ingestionTimer)clearInterval(ingestionTimer);if(aiProcess)aiProcess.kill();server.close(()=>process.exit(0))});
module.exports = server;
