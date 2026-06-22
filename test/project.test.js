const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
const {analytics}=require('../src/store');
test('dashboard source has no fabricated seed incidents',()=>{
 const code=fs.readFileSync('src/store.js','utf8');
 assert.match(code,/const incidents=\[\]/);
 assert.doesNotMatch(code,/DR-2025-|MH 12 AB 4581|UP 32 LT 9910|seed/i);
 assert.equal(analytics([]).accuracy,null);
});
test('genuine inference service contract is present',()=>{
 const code=fs.readFileSync('ai_service.py','utf8');
 assert.match(code,/YOLOWorld/); assert.match(code,/easyocr\.Reader/); assert.match(code,/genuineInference/);
 assert.doesNotMatch(code,/person without seat belt",/);
 assert.match(code,/extract_stamp_metadata/);
 assert.match(code,/plate_variants/);
});
test('browser file opening self-corrects to localhost',()=>{assert.match(fs.readFileSync('public/index.html','utf8'),/location\.protocol==='file:'/)});
test('mapmyindia integration is wired through backend config',()=>{
 const server=fs.readFileSync('server.js','utf8');
 const map=fs.readFileSync('src/mapmyindia.js','utf8');
 assert.match(server,/\/api\/map\/config/);
 assert.match(server,/\/api\/map\/auth-status/);
 assert.match(map,/MAPMYINDIA_STATIC_KEY/);
 assert.match(map,/MAPPLS_CLIENT_SECRET/);
 assert.match(fs.readFileSync('.gitignore','utf8'),/^\.env$/m);
});
test('national-level evidence workflow is wired',()=>{
 const server=fs.readFileSync('server.js','utf8');
 const html=fs.readFileSync('public/index.html','utf8');
 const app=fs.readFileSync('public/app.js','utf8');
 assert.match(server,/dossierHtml/);
 assert.match(server,/\/review/);
 assert.match(server,/AUTO_APPROVE_THRESHOLD/);
 assert.match(server,/payload\.plate/);
 assert.match(html,/Review queue/);
 assert.match(html,/Calibration studio/);
 assert.match(html,/AI VIOLATION JUDGE/);
 assert.match(app,/readiness-ring/);
 assert.match(app,/targetCropHtml/);
 assert.match(app,/themeToggle/);
 assert.match(server,/Challan reason/);
});
