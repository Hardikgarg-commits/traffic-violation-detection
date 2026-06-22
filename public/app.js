const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)]; let selected=null, cache=[], analyticsCache=null;
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
function toast(msg){const x=$('#toast');x.textContent=msg;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2400)}
function applyTheme(v){document.body.dataset.theme=v;localStorage.setItem('drishti-theme',v);const b=$('#themeToggle');if(b)b.textContent=v==='dark'?'☀ Light':'☾ Dark'}
function ensureUiExtras(){if(!$('#themeToggle')){$('.header-actions')?.insertAdjacentHTML('afterbegin','<button class="secondary compact" id="themeToggle">☾ Dark</button>');$('#themeToggle').onclick=()=>applyTheme(document.body.dataset.theme==='dark'?'light':'dark')}if(!$('#operatorMenu')){$('.operator')?.insertAdjacentHTML('afterend','<div id="operatorMenu" class="operator-menu"><b>Operator tools</b><button data-go="review">Open review queue</button><button id="quickTheme">Toggle theme</button><small>Human override is enabled for every AI decision.</small></div>');$('#quickTheme').onclick=()=>$('#themeToggle').click();$$('#operatorMenu [data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$('.operator button')?.addEventListener('click',()=>$('#operatorMenu').classList.toggle('show'))}}
function go(id){$$('.page,.nav').forEach(x=>x.classList.remove('active'));$('#'+id)?.classList.add('active');$(`.nav[data-page="${id}"]`)?.classList.add('active');$('#eyebrow').textContent=`COMMAND CENTER / ${id.toUpperCase()}`;$('#title').textContent=id==='overview'?'Gridlock traffic intelligence':id[0].toUpperCase()+id.slice(1);if(id==='incidents')loadIncidents();if(id==='review')renderReview();window.scrollTo(0,0)}
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));$$('.nav').forEach(b=>b.onclick=()=>go(b.dataset.page));$('#menu').onclick=()=>$('.sidebar').classList.toggle('open');
async function load(){const [a,i]=await Promise.all([fetch('/api/analytics').then(r=>r.json()),fetch('/api/incidents').then(r=>r.json())]);analyticsCache=a;cache=i.incidents;$('#today').textContent=a.today;const ready=$('#readinessAvg')||$('#accuracy');if(ready)ready.textContent=a.avgReadiness===null?'—':a.avgReadiness+'/100';$('#queue').textContent=String(a.reviewQueue).padStart(2,'0');renderRecent(cache.slice(0,4));renderDist(a.byType);renderBars(a.hourly);renderHotspots(a.hotspots||[]);fillTypes(a.byType);renderReview()}
async function initMapMyIndia(){const box=$('#mmiMap');if(!box)return;try{const [cfg,cam]=await Promise.all([fetch('/api/map/config').then(r=>r.json()),fetch('/api/map/cameras').then(r=>r.json())]);const c=cfg.center||{lat:12.9716,lng:77.5946};$('#mapProvider').textContent=cfg.provider||'MapmyIndia / Mappls';$('#mapStatus').textContent=cfg.enabled?'Key active':'Key missing';$('#mapFallback').href=`https://www.mappls.com/@${c.lat},${c.lng},12z`;const fallback=msg=>{box.innerHTML=`<div><strong>${msg}</strong><span>${cfg.note||'Map layer configured for camera coordinates.'}</span><small>${(cam.cameras||[]).map(x=>`${x.id}: ${x.name}`).join(' · ')}</small></div>`};if(!cfg.enabled)return fallback('Map key not configured');window.__drishtiMapReady=()=>{try{box.innerHTML='';const map=new mappls.Map('mmiMap',{center:[c.lat,c.lng],zoom:12,zoomControl:true,location:false});(cam.cameras||[]).forEach(x=>{if(window.mappls?.Marker)new mappls.Marker({map,position:{lat:x.lat,lng:x.lng},title:`${x.id} · ${x.name}`})});$('#mapStatus').textContent='Live';}catch(e){fallback('Map SDK loaded; using evidence fallback')}};const s=document.createElement('script');s.src=cfg.sdkUrl;s.async=true;s.onerror=()=>fallback('Map SDK unavailable offline');document.head.appendChild(s)}catch(e){box.innerHTML='<div><strong>Map unavailable</strong><span>Could not load MapmyIndia configuration.</span></div>'}}
function renderRecent(rows){$('#recent').innerHTML=rows.length?rows.map(x=>`<div class="recent-row"><div class="violation-icon">!</div><div><b>${x.type}</b><span>${x.id} · ${fmt(x.timestamp)}</span></div><div><b>${x.plate}</b><span>${x.location}</span></div><div class="confidence">${x.confidence}%</div></div>`).join(''):'<div style="padding:28px;color:#899498;font-size:10px">No genuine analyses yet. Analyze an image to create the first record.</div>'}
function renderDist(rows){if(!rows.length){$('#distribution').innerHTML='<div style="padding:28px 0;color:#899498;font-size:10px">Distribution appears after genuine incidents are created.</div>';return}const colors=['#ff6c4b','#5276ff','#41a676','#f2bb42','#8d70d6','#3eb7b0','#9aa4a8'],max=Math.max(...rows.map(x=>x.value));$('#distribution').innerHTML=rows.slice(0,5).map((x,j)=>`<div class="dist-row"><div><span>${x.name}</span><b>${x.value}</b></div><div class="track"><i style="width:${x.value/max*100}%;background:${colors[j]}"></i></div></div>`).join('')}
function renderBars(vals){const max=Math.max(1,...vals);$('#bars').innerHTML=vals.map(v=>`<i style="height:${Math.max(2,v/max*100)}%" data-value="${v}"></i>`).join('')}
function renderHotspots(rows){const el=$('#hotspots');if(!el)return;el.innerHTML=rows.length?rows.map((x,i)=>`<div class="hotspot"><b>#${i+1}</b><span>${safe(x.name)}</span><em>${x.value} records</em></div>`).join(''):'<div class="hotspot"><b>0</b><span>No hotspot yet</span><em>Analyze frames to populate</em></div>'}
function fillTypes(rows){const el=$('#typeFilter');if(!el||el.dataset.ready)return;el.innerHTML='<option value="all">All violation types</option>'+[...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option>${safe(x.name)}</option>`).join('');el.dataset.ready='1'}
async function loadIncidents(){const q=encodeURIComponent($('#search').value),type=encodeURIComponent($('#typeFilter').value);const d=await fetch(`/api/incidents?q=${q}&type=${type}`).then(r=>r.json());$('#incidentTable').innerHTML=d.incidents.map(x=>`<tr><td><b>${safe(x.id)}</b><br><small>${safe(x.location)}</small></td><td>${fmt(x.timestamp)}</td><td><span class="tag">${safe(x.type)}</span></td><td><b>${safe(x.plate)}</b></td><td><div class="mini-score">${x.readiness??x.confidence}/100</div></td><td class="status">● ${safe(x.status)}</td><td><a class="text-btn" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Open dossier</a></td></tr>`).join('')||'<tr><td colspan="7">No evidence records yet.</td></tr>'}
$('#search').oninput=loadIncidents;$('#typeFilter').onchange=loadIncidents;
function renderReview(){const el=$('#reviewQueue');if(!el)return;const rows=cache.filter(x=>x.status==='Needs review'||x.status==='No enforceable event').slice(0,8);el.innerHTML=rows.length?rows.map(x=>`<article class="review-card"><div><span>${safe(x.id)}</span><h3>${safe(x.type)}</h3><p>${safe(x.aiJudge||'Needs human decision')}</p></div><div class="readiness-ring">${x.readiness??0}<small>/100</small></div><ul>${(x.reasoning||[]).slice(0,3).map(r=>`<li>${safe(r)}</li>`).join('')}</ul><textarea placeholder="Reviewer note" id="note-${safe(x.id)}"></textarea><div class="review-actions"><button class="secondary" onclick="reviewIncident('${safe(x.id)}','Rejected')">Reject</button><button class="primary" onclick="reviewIncident('${safe(x.id)}','Approved')">Approve</button><a class="secondary" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Dossier</a></div></article>`).join(''):'<div class="panel empty-review"><h3>No pending cases</h3><p>New AI detections that need human verification will appear here.</p></div>'}
async function reviewIncident(id,status){const note=$(`#note-${CSS.escape(id)}`)?.value||'';const r=await fetch(`/api/incidents/${encodeURIComponent(id)}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,note,by:'Traffic reviewer'})});if(!r.ok)return toast('Review update failed');toast(`Incident ${status.toLowerCase()}`);await load();renderReview();if($('.page.active')?.id==='incidents')loadIncidents()}
window.reviewIncident=reviewIncident;
async function load(){const [a,i]=await Promise.all([fetch('/api/analytics').then(r=>r.json()),fetch('/api/incidents').then(r=>r.json())]);analyticsCache=a;cache=i.incidents;$('#today').textContent=a.today;const ready=$('#readinessAvg')||$('#accuracy');if(ready)ready.textContent=a.avgReadiness===null?'—':a.avgReadiness+'/100';$('#queue').textContent=String(a.reviewQueue).padStart(2,'0');renderRecent(cache.slice(0,4));renderDist(a.byType);renderBars(a.hourly);renderHotspots(a.hotspots||[]);renderAnalyticsSummary(a);fillTypes(a.byType);renderReview();if($('.page.active')?.id==='incidents')loadIncidents()}
function renderRecent(rows){$('#recent').innerHTML=rows.length?rows.map(x=>`<div class="recent-row"><div class="violation-icon">!</div><div><b>${safe(x.type)}</b><span>${safe(x.id)} · ${fmt(x.timestamp)}</span></div><div><b>${safe(x.plate)}</b><span>${safe(x.status)} · ${safe(x.location)}</span></div><div class="confidence">${x.readiness??x.confidence}</div></div>`).join(''):'<div class="empty-mini">No genuine analyses yet. Analyze an image to create the first record.</div>'}
function renderAnalyticsSummary(a){const card=$('.model-card');if(!card||!a)return;const score=card.querySelector('.score strong');const small=card.querySelector('.score small');if(score)score.textContent=a.avgReadiness===null?'—':a.avgReadiness;if(small)small.textContent=' readiness avg';const rows=card.querySelectorAll('.health-row b');if(rows[0])rows[0].textContent=a.reviewPrecision===null?'Pending':a.reviewPrecision+'%';if(rows[1])rows[1].textContent=a.approved+' approved';if(rows[2])rows[2].textContent=a.rejected+' cancelled/rejected'}
function renderReview(){const el=$('#reviewQueue');if(!el)return;const rows=cache.filter(x=>['AI approved','AI rejected','Needs review','No enforceable event'].includes(x.status)).slice(0,10);el.innerHTML=rows.length?rows.map(x=>`<article class="review-card"><div><span>${safe(x.id)} · ${safe(x.status)}</span><h3>${safe(x.type)}</h3><p>${safe(x.aiJudge||'AI decision available for human override')}</p></div><div class="readiness-ring">${x.readiness??0}<small>/100</small></div>${x.evidence?.target?`<img class="review-target" src="/evidence/${x.evidence.target.split(/[\\\\/]/).pop()}" alt="challan subject crop">`:''}<ul>${(x.reasoning||[]).slice(0,3).map(r=>`<li>${safe(r)}</li>`).join('')}</ul><input class="plate-input" placeholder="Manual registration if OCR failed" value="${x.plate==='Not readable'?'':safe(x.plate)}" id="plate-${safe(x.id)}"><textarea placeholder="Reviewer note / override reason" id="note-${safe(x.id)}"></textarea><div class="review-actions"><button class="secondary" onclick="reviewIncident('${safe(x.id)}','Cancelled')">Cancel challan</button><button class="secondary" onclick="reviewIncident('${safe(x.id)}','Rejected')">Reject</button><button class="primary" onclick="reviewIncident('${safe(x.id)}','Approved')">Approve</button><a class="secondary" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Dossier</a></div></article>`).join(''):'<div class="panel empty-review"><h3>No optional review cases</h3><p>Approved, rejected and cancelled records remain visible in Evidence registry and Analytics.</p></div>'}
async function reviewIncident(id,status){const note=$(`#note-${CSS.escape(id)}`)?.value||'';const plate=$(`#plate-${CSS.escape(id)}`)?.value||'';const r=await fetch(`/api/incidents/${encodeURIComponent(id)}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,note,plate,by:'Traffic reviewer'})});if(!r.ok)return toast('Review update failed');cache=cache.map(x=>x.id===id?{...x,status,plate:plate||x.plate,review:{note,by:'Traffic reviewer',at:new Date().toISOString()}}:x);renderReview();if($('.page.active')?.id==='incidents')loadIncidents();toast(`Incident ${status.toLowerCase()}`);load()}
window.reviewIncident=reviewIncident;
function targetCropHtml(x){return x.targetImage?`<div class="target-strip"><img src="${x.targetImage}" alt="cropped challan subject"><div><b>Challan subject crop</b><span>Use this to identify the exact rider/vehicle inside the full scene.</span></div></div>`:''}
function injectTargetCrop(x){const box=$('#resultPanel .reason-box');if(box&&x.targetImage)box.insertAdjacentHTML('beforebegin',targetCropHtml(x))}
const dz=$('#dropzone'), file=$('#file');$('#browse').onclick=e=>{e.stopPropagation();file.click()};$('#demo').onclick=e=>{e.stopPropagation();useDemo()};$('#demoTour').onclick=()=>{go('analyze');useDemo();$('#location').value='MG Road, Bengaluru';toast('Demo story loaded: run analysis to generate the dossier')};dz.onclick=()=>file.click();['dragenter','dragover'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.add('drag')}));['dragleave','drop'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.remove('drag')}));dz.ondrop=e=>pick(e.dataTransfer.files[0]);file.onchange=()=>pick(file.files[0]);
function pick(f){if(!f)return;if(f.size>8e6)return toast('Image must be smaller than 8 MB');if(!f.type.startsWith('image/'))return toast('Please choose an image file');const r=new FileReader();r.onload=()=>{selected={name:f.name,image:r.result};dz.innerHTML=`<img src="${r.result}" style="width:100%;height:310px;object-fit:contain;border-radius:9px"><p style="margin-top:10px">${f.name} · ${(f.size/1024).toFixed(0)} KB</p>`;$('#analyzeBtn').disabled=false};r.readAsDataURL(f)}
function useDemo(){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#758b93"/><stop offset=".45" stop-color="#bac3c0"/><stop offset=".46" stop-color="#3c494d"/></linearGradient></defs><rect width="1200" height="700" fill="url(#s)"/><path d="M0 650L530 330M1200 650L680 330" stroke="#f7e99b" stroke-width="10" stroke-dasharray="90 50"/><g transform="translate(455 260)"><circle cx="80" cy="250" r="66" fill="#172229"/><circle cx="300" cy="250" r="66" fill="#172229"/><path d="M75 245L145 120H275L310 245Z" fill="#e6513a"/><circle cx="205" cy="63" r="41" fill="#bd7d58"/><path d="M180 108L145 205M230 105L275 197" stroke="#24343a" stroke-width="24"/><rect x="165" y="235" width="96" height="29" rx="4" fill="#eee"/><text x="174" y="255" font-family="monospace" font-size="15">MH12AB4581</text></g><text x="30" y="45" fill="white" font-family="monospace" font-size="18">CAM 04 · 20/06/2026 · 09:42:18</text></svg>`;selected={name:'demo-no-helmet.svg',image:'data:image/svg+xml;base64,'+btoa(svg)};dz.innerHTML=`<img src="${selected.image}" style="width:100%;height:310px;object-fit:contain;border-radius:9px"><p style="margin-top:10px">demo-no-helmet.svg · sample roadside frame</p>`;$('#analyzeBtn').disabled=false;toast('Demo frame loaded')}
$('#analyzeBtn').onclick=async()=>{if(!selected)return;const panel=$('#resultPanel');panel.innerHTML='<div class="loading"><div><div class="spinner"></div><h3>Building AI evidence dossier</h3><p>Preprocess → YOLO-World → spatial reasoning → EasyOCR → AI Judge…</p><small>First run can take longer while models initialize.</small></div></div>';try{const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected,location:$('#location').value||undefined,capturedAt:$('#captureTime').value||undefined})});const d=await r.json();if(!r.ok)throw Error(d.error);const x=d.incident;const counts=Object.entries(d.objectCounts||{}).map(([k,v])=>`${v} ${k}`).join(' · ')||'No objects above confidence threshold';const limits=(d.notEvaluated||[]).map(v=>`<p><b>${safe(v.type)}:</b> ${safe(v.reason)}</p>`).join('');panel.innerHTML=`<div class="result-image"><img src="${x.annotatedImage}" alt="Genuine model detections"></div><div class="result-info dossier"><div class="result-top"><div><span>AI EVIDENCE DOSSIER</span><h3>${safe(x.type)}</h3><span>${safe(x.id)}</span></div><div class="readiness-ring">${x.readiness}<small>/100</small></div></div><div class="judge-verdict"><b>${safe(x.aiJudge)}</b><span>${safe(x.readinessLabel)}</span></div><div class="evidence-grid"><div><span>REGISTRATION</span><b>${safe(x.plate)}</b></div><div><span>VEHICLE</span><b>${safe(x.vehicle)}</b></div><div><span>PROCESSING</span><b>${d.processingMs} ms</b></div><div><span>LOCATION</span><b>${safe(x.location)}</b></div><div><span>STATUS</span><b>${safe(x.status)}</b></div><div><span>DETECTIONS</span><b>${d.detections.length} objects</b></div></div><div class="reason-box"><b>Explainable AI reasoning</b><ul>${(x.reasoning||[]).map(v=>`<li>${safe(v)}</li>`).join('')}</ul></div><div class="object-summary"><b>Detected:</b> ${safe(counts)}</div><div class="model-proof"><span>✓ ${safe(d.model.detector)}</span><span>✓ ${safe(d.model.ocr)}</span><span>✓ Real inference</span></div><details class="limitations"><summary>Rules not evaluated from this image (${d.notEvaluated.length})</summary>${limits}</details><a class="primary dossier-link" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Open printable dossier →</a></div>`;toast('Evidence dossier generated');load()}catch(e){panel.innerHTML=`<div class="empty-result"><div>!</div><h3>Analysis failed</h3><p>${safe(e.message)}</p><p>Run npm run setup:ai, then restart npm start.</p></div>`}};
$('#analyzeBtn').onclick=async()=>{if(!selected)return;const panel=$('#resultPanel');panel.innerHTML='<div class="loading"><div><div class="spinner"></div><h3>Building AI evidence dossier</h3><p>AI threshold → target crop → OCR → human override workflow…</p></div></div>';try{const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected,location:$('#location').value||undefined,capturedAt:$('#captureTime').value||undefined})});const d=await r.json();if(!r.ok)throw Error(d.error);const x=d.incident;const counts=Object.entries(d.objectCounts||{}).filter(([k])=>!k.includes('seat')).map(([k,v])=>`${v} ${k}`).join(' · ')||'No objects above confidence threshold';const limits=(d.notEvaluated||[]).map(v=>`<p><b>${safe(v.type)}:</b> ${safe(v.reason)}</p>`).join('');panel.innerHTML=`<div class="result-image"><img src="${x.annotatedImage}" alt="Full annotated scene"></div><div class="result-info dossier"><div class="result-top"><div><span>AI EVIDENCE DOSSIER</span><h3>${safe(x.type)}</h3><span>${safe(x.id)} · threshold ${x.decisionThreshold||70}/100</span></div><div class="readiness-ring">${x.readiness}<small>/100</small></div></div><div class="judge-verdict"><b>${safe(x.aiJudge)}</b><span>${safe(x.status)} — human can override</span></div><div class="evidence-grid"><div><span>REGISTRATION</span><b>${safe(x.plate)}</b></div><div><span>VEHICLE</span><b>${safe(x.vehicle)}</b></div><div><span>REASON</span><b>${safe(x.challanReason)}</b></div><div><span>LOCATION</span><b>${safe(x.location)}</b></div><div><span>STATUS</span><b>${safe(x.status)}</b></div><div><span>DETECTIONS</span><b>${d.detections.length} objects</b></div></div>${targetCropHtml(x)}<div class="reason-box"><b>Explainable AI reasoning</b><ul>${(x.reasoning||[]).map(v=>`<li>${safe(v)}</li>`).join('')}</ul></div><div class="object-summary"><b>Detected:</b> ${safe(counts)}</div><div class="model-proof"><span>✓ ${safe(d.model.detector)}</span><span>✓ ${safe(d.model.ocr)}</span><span>✓ Human override ready</span></div><details class="limitations"><summary>Rules not evaluated from this image (${d.notEvaluated.length})</summary>${limits}</details><a class="primary dossier-link" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Open printable dossier →</a></div>`;toast('Evidence dossier generated');await load()}catch(e){panel.innerHTML=`<div class="empty-result"><div>!</div><h3>Analysis failed</h3><p>${safe(e.message)}</p><p>Run npm run setup:ai, then restart npm start.</p></div>`}};
ensureUiExtras();applyTheme(localStorage.getItem('drishti-theme')||'light');$('#captureTime').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);load().catch(()=>toast('Could not connect to the service'));initMapMyIndia();

function ensureAnalyticsShell(){
  const page=$('#analytics');
  if(!page)return;
  if(!$('#opsStats')){
    page.querySelector('.page-intro')?.insertAdjacentHTML('afterend','<div id="opsStats" class="ops-stats"></div>');
  }
  if(!$('#analyticsExtra')){
    page.querySelector('.analytics-grid')?.insertAdjacentHTML('afterend','<div id="analyticsExtra" class="analytics-extra"><section class="panel"><span>REVIEW OPERATIONS</span><h3>Decision workflow</h3><div id="statusStats" class="stat-list"></div></section><section class="panel"><span>FIELD INTELLIGENCE</span><h3>Vehicles & OCR</h3><div id="vehicleStats" class="stat-list"></div></section></div>');
  }
}

function ensureIngestionControls(){
  const page=$('#ingestion .page-intro > div:last-child');
  if(!page||$('#demoFeed'))return;
  page.insertAdjacentHTML('beforeend',' <button class="primary" id="demoFeed">Start demo feed</button> <button class="secondary" id="stopDemoFeed" disabled>Stop feed</button>');
  let feedTimer=null, feedLeft=0;
  const step=async()=>{
    if(feedLeft<=0){clearInterval(feedTimer);feedTimer=null;$('#demoFeed').disabled=false;$('#stopDemoFeed').disabled=true;toast('Demo feed finished');return}
    feedLeft-=1;
    await fetch('/api/ingestion/replay-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:1})});
    await loadIngestion();
  };
  $('#demoFeed').onclick=async()=>{feedLeft=20;$('#demoFeed').disabled=true;$('#stopDemoFeed').disabled=false;toast('Demo feed started: 20 frames');await step();feedTimer=setInterval(step,2000)};
  $('#stopDemoFeed').onclick=()=>{feedLeft=0;if(feedTimer)clearInterval(feedTimer);feedTimer=null;$('#demoFeed').disabled=false;$('#stopDemoFeed').disabled=true;toast('Demo feed stopped')};
}

async function load(){
  ensureAnalyticsShell();
  const [a,i]=await Promise.all([fetch('/api/analytics').then(r=>r.json()),fetch('/api/incidents').then(r=>r.json())]);
  analyticsCache=a;cache=i.incidents||[];
  $('#today').textContent=a.today;
  const ready=$('#readinessAvg')||$('#accuracy');
  if(ready)ready.textContent=a.avgReadiness===null?'—':a.avgReadiness+'/100';
  $('#queue').textContent=String(a.reviewQueue).padStart(2,'0');
  renderRecent(cache.slice(0,4));
  renderDist(a.byType||[]);
  renderBars(a.hourly||[]);
  renderHotspots(a.hotspots||[]);
  renderAnalyticsSummary(a);
  fillTypes(a.byType||[]);
  renderReview();
  if($('.page.active')?.id==='incidents')await loadIncidents();
}

function fillTypes(rows){
  const el=$('#typeFilter');if(!el)return;
  const current=el.value||'all';
  el.innerHTML='<option value="all">All violation types</option>'+[...rows].sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option value="${safe(x.name)}">${safe(x.name)}</option>`).join('');
  el.value=[...el.options].some(o=>o.value===current)?current:'all';
}

async function loadIncidents(){
  const q=encodeURIComponent($('#search')?.value||''),type=encodeURIComponent($('#typeFilter')?.value||'all');
  const d=await fetch(`/api/incidents?q=${q}&type=${type}`).then(r=>r.json());
  const rows=d.incidents||[];
  const table=$('#incidentTable'); if(!table)return;
  table.innerHTML=rows.map(x=>`<tr><td><b>${safe(x.id)}</b><br><small>${safe(x.subjectId||'full-frame evidence')}</small></td><td>${fmt(x.timestamp)}</td><td><span class="tag">${safe(x.type)}</span><br><small>${safe(x.challanReason||'')}</small></td><td><b>${safe(x.plate)}</b></td><td><div class="mini-score">${x.readiness??x.confidence}/100</div></td><td class="status">● ${safe(x.status)}</td><td><a class="text-btn" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Open dossier</a></td></tr>`).join('')||'<tr><td colspan="7">No evidence records yet. Analyze an image to populate this registry.</td></tr>';
}

function renderAnalyticsSummary(a){
  const stats=$('#opsStats');
  if(stats){
    stats.innerHTML=[
      ['Total records',a.total??0,'all generated challan/evidence rows'],
      ['AI approved',a.autoApproved??0,`threshold based · ${a.reviewQueue??0} in queue`],
      ['Plate readable',a.plateReadable===null?'—':a.plateReadable+'%',`${a.unreadablePlates??0} need manual plate entry`],
      ['Avg confidence',a.avgConfidence===null?'—':a.avgConfidence+'%',`readiness ${a.avgReadiness===null?'—':a.avgReadiness+'/100'}`]
    ].map(([k,v,s])=>`<article class="ops-card"><span>${k}</span><b>${v}</b><small>${s}</small></article>`).join('');
  }
  const card=$('.model-card');
  if(card){
    const score=card.querySelector('.score strong'), small=card.querySelector('.score small'), rows=card.querySelectorAll('.health-row b');
    const labels=card.querySelectorAll('.health-row span');
    if(labels[0])labels[0].textContent='Reviewer approval rate';
    if(labels[1])labels[1].textContent='Human approved';
    if(labels[2])labels[2].textContent='Rejected / cancelled';
    if(score)score.textContent=a.avgReadiness===null?'—':a.avgReadiness;
    if(small)small.textContent=' readiness avg';
    if(rows[0])rows[0].textContent=a.reviewPrecision===null?'Pending':a.reviewPrecision+'% reviewer approval rate';
    if(rows[1])rows[1].textContent=(a.approved??0)+' human approved';
    if(rows[2])rows[2].textContent=(a.rejected??0)+' rejected/cancelled';
  }
  const status=$('#statusStats');
  if(status){
    const rows=(a.statusBreakdown||[]).length?a.statusBreakdown:[{name:'No records yet',value:0}];
    status.innerHTML=rows.map(x=>`<div><span>${safe(x.name)}</span><b>${x.value}</b></div>`).join('');
  }
  const vehicles=$('#vehicleStats');
  if(vehicles){
    const top=(a.vehicles||[]).length?a.vehicles:[{name:'Awaiting detections',value:0}];
    vehicles.innerHTML=`<div><span>Unreadable plates</span><b>${a.unreadablePlates??0}</b></div>`+top.map(x=>`<div><span>${safe(x.name)}</span><b>${x.value}</b></div>`).join('');
  }
}

function renderReview(){
  const el=$('#reviewQueue');if(!el)return;
  const rows=cache.filter(x=>['AI approved','AI rejected','Needs review','No enforceable event'].includes(x.status)).slice(0,12);
  el.innerHTML=rows.length?rows.map(x=>`<article class="review-card"><div><span>${safe(x.id)} · ${safe(x.status)}</span><h3>${safe(x.type)}</h3><p>${safe(x.aiJudge||'AI decision available for human override')}</p></div><div class="readiness-ring">${x.readiness??0}<small>/100</small></div>${x.evidence?.target?`<img class="review-target" src="/evidence/${x.evidence.target.split(/[\\\\/]/).pop()}" alt="challan subject crop">`:''}<ul>${(x.reasoning||[]).slice(0,4).map(r=>`<li>${safe(r)}</li>`).join('')}</ul><input class="plate-input" placeholder="Manual registration if OCR failed" value="${x.plate==='Not readable'?'':safe(x.plate)}" id="plate-${safe(x.id)}"><textarea placeholder="Reviewer note / override reason" id="note-${safe(x.id)}"></textarea><div class="review-actions"><button class="secondary" onclick="reviewIncident('${safe(x.id)}','Cancelled')">Cancel challan</button><button class="secondary" onclick="reviewIncident('${safe(x.id)}','Rejected')">Reject</button><button class="primary" onclick="reviewIncident('${safe(x.id)}','Approved')">Approve</button><a class="secondary" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Dossier</a></div></article>`).join(''):'<div class="panel empty-review"><h3>No optional review cases</h3><p>Approved, rejected and cancelled records remain visible in Evidence registry and Analytics.</p></div>';
}

$('#analyzeBtn').onclick=async()=>{
  if(!selected)return;
  const panel=$('#resultPanel');
  panel.innerHTML='<div class="loading"><div><div class="spinner"></div><h3>Building AI evidence dossier</h3><p>Multi-challan scan → target crops → OCR → AI threshold → registry sync…</p></div></div>';
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected,location:$('#location').value||undefined,capturedAt:$('#captureTime').value||undefined})});
    const d=await r.json(); if(!r.ok)throw Error(d.error);
    const x=d.incident, generated=(d.incidents||[x]).length;
    const counts=Object.entries(d.objectCounts||{}).filter(([k])=>!k.includes('seat')).map(([k,v])=>`${v} ${k}`).join(' · ')||'No objects above confidence threshold';
    const limits=(d.notEvaluated||[]).map(v=>`<p><b>${safe(v.type)}:</b> ${safe(v.reason)}</p>`).join('');
    panel.innerHTML=`<div class="result-image"><img src="${x.annotatedImage}" alt="Full annotated scene"></div><div class="result-info dossier"><div class="result-top"><div><span>AI EVIDENCE DOSSIER</span><h3>${safe(x.type)}</h3><span>${safe(x.id)} · threshold ${x.decisionThreshold||70}/100</span></div><div class="readiness-ring">${x.readiness}<small>/100</small></div></div><div class="multi-note">${generated} challan/evidence record${generated===1?'':'s'} generated from this single image and synced to Evidence registry.</div><div class="judge-verdict"><b>${safe(x.aiJudge)}</b><span>${safe(x.status)} — human can override</span></div><div class="evidence-grid"><div><span>REGISTRATION</span><b>${safe(x.plate)}</b></div><div><span>VEHICLE</span><b>${safe(x.vehicle)}</b></div><div><span>REASON</span><b>${safe(x.challanReason)}</b></div><div><span>LOCATION</span><b>${safe(x.location)}</b></div><div><span>STATUS</span><b>${safe(x.status)}</b></div><div><span>DETECTIONS</span><b>${d.detections.length} objects</b></div></div>${targetCropHtml(x)}<div class="reason-box"><b>Explainable AI reasoning</b><ul>${(x.reasoning||[]).map(v=>`<li>${safe(v)}</li>`).join('')}</ul></div><div class="object-summary"><b>Detected:</b> ${safe(counts)}</div><div class="model-proof"><span>✓ ${safe(d.model.detector)}</span><span>✓ ${safe(d.model.ocr)}</span><span>✓ Multi-challan registry sync</span></div><details class="limitations"><summary>Rules not evaluated from this image (${d.notEvaluated.length})</summary>${limits}</details><a class="primary dossier-link" target="_blank" href="/api/incidents/${encodeURIComponent(x.id)}/dossier">Open printable dossier →</a></div>`;
    toast(`${generated} record${generated===1?'':'s'} added to registry`);
    await load();
  }catch(e){
    panel.innerHTML=`<div class="empty-result"><div>!</div><h3>Analysis failed</h3><p>${safe(e.message)}</p><p>Run npm run setup:ai, then restart npm start.</p></div>`;
  }
};

load().catch(()=>{});

async function loadIngestion(){
  ensureIngestionControls();
  const stats=$('#ingestStats'), table=$('#frameTable');
  if(!stats||!table)return;
  try{
    const d=await fetch('/api/ingestion').then(r=>r.json());
    const s=d.status||{};
    $('#ingestDir').textContent=(d.incomingDir||'data/incoming_frames').replace(/^.*[\\\/]data[\\\/]/,'data/');
    stats.innerHTML=[
      ['Total frames',s.total??0,'all rows in incoming_frames'],
      ['Queued',s.queued??0,'waiting for AI worker'],
      ['Processed',s.processed??0,'converted to evidence'],
      ['Failed',s.failed??0,d.busy?'worker busy':'ready']
    ].map(([k,v,sub])=>`<article class="ops-card"><span>${k}</span><b>${v}</b><small>${safe(sub)}</small></article>`).join('');
    table.innerHTML=(d.frames||[]).map(f=>`<tr><td><b>${safe(f.id)}</b><br><small>${safe(f.filename)}</small></td><td>${safe(f.cameraId)}<br><small>${safe(f.location)}</small></td><td>${fmt(f.capturedAt||f.receivedAt)}</td><td><span class="tag">${safe(f.status)}</span></td><td><b>${(f.generatedIncidents||[]).length}</b><br><small>${(f.generatedIncidents||[]).slice(0,2).map(safe).join(', ')}</small></td><td>${safe(f.error||'—')}</td></tr>`).join('')||'<tr><td colspan="6">No frames yet. Drop images into data/incoming_frames or run watcher.py.</td></tr>';
  }catch(e){
    table.innerHTML=`<tr><td colspan="6">Ingestion API unavailable: ${safe(e.message)}</td></tr>`;
  }
}

$('#scanFrames')?.addEventListener('click',async()=>{await fetch('/api/ingestion/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});toast('Incoming folder scanned');loadIngestion()});
$('#processFrame')?.addEventListener('click',async()=>{toast('Processing next queued frame…');await fetch('/api/ingestion/process',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await Promise.all([loadIngestion(),load()]);toast('Ingestion worker updated')});
setInterval(()=>{if($('.page.active')?.id==='ingestion')loadIngestion()},3000);

const previousGo=go;
go=function(id){previousGo(id);if(id==='ingestion')loadIngestion()};

const previousLoad=load;
load=async function(){
  await previousLoad();
  if($('.page.active')?.id==='ingestion')await loadIngestion();
};
