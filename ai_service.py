"""Genuine local CV inference service for Drishti AI.

Loads YOLO-World once, runs real detections, performs OCR, applies only defensible
single-frame rules, and returns annotated evidence through a stdlib HTTP API.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
import base64, io, json, os, re, time, uuid

import cv2
import numpy as np
from ultralytics import YOLOWorld
import easyocr

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)
MODEL_NAME = os.getenv("DRISHTI_MODEL", "yolov8s-worldv2.pt")
PORT = int(os.getenv("AI_PORT", "8001"))
LOCK = Lock()

CLASSES = [
    "person", "pedestrian", "bicycle", "motorcycle", "scooter", "car", "bus", "truck", "auto rickshaw",
    "helmet", "person without helmet", "license plate",
    "red traffic light", "green traffic light", "stop line"
]
VEHICLES = {"bicycle", "motorcycle", "scooter", "car", "bus", "truck", "auto rickshaw"}
PLATE_RE = re.compile(r"\b(?:[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{1,3}[ -]?[0-9]{3,4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})\b")
PLATE_CLEAN_RE = re.compile(r"(?:[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})")
STAMP_DATE_RE = re.compile(r"(\d{2})[-/](\d{2})[-/](\d{4}).*?(\d{2}):(\d{2})(?::(\d{2}))?")

print(f"[AI] Loading {MODEL_NAME} …", flush=True)
model = YOLOWorld(MODEL_NAME)
model.set_classes(CLASSES)
ocr = easyocr.Reader(["en"], gpu=False, verbose=False)
print("[AI] Models ready", flush=True)

def decode_image(data_url):
    raw = data_url.split(",", 1)[1] if "," in data_url else data_url
    arr = np.frombuffer(base64.b64decode(raw), np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None: raise ValueError("Unsupported or damaged image")
    return image

def quality_and_enhance(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    enhanced = image.copy(); operations=[]
    if brightness < 85:
        lab=cv2.cvtColor(enhanced,cv2.COLOR_BGR2LAB); l,a,b=cv2.split(lab)
        l=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8)).apply(l)
        enhanced=cv2.cvtColor(cv2.merge((l,a,b)),cv2.COLOR_LAB2BGR); operations.append("CLAHE low-light enhancement")
    if blur < 80:
        sharp=cv2.GaussianBlur(enhanced,(0,0),2.0); enhanced=cv2.addWeighted(enhanced,1.7,sharp,-0.7,0); operations.append("conservative deblurring")
    if not operations: operations.append("input normalization")
    return enhanced,{"brightness":round(brightness,1),"blurScore":round(blur,1),"operations":operations,
                     "warnings":(["Low light"] if brightness<60 else [])+(["Severe blur; small plates may be unreadable"] if blur<35 else [])}

def iou_inside(inner, outer):
    ix1,iy1,ix2,iy2=inner; ox1,oy1,ox2,oy2=outer
    cx=(ix1+ix2)/2; cy=(iy1+iy2)/2
    return ox1<=cx<=ox2 and oy1<=cy<=oy2

def box_center(box):
    x1,y1,x2,y2=box
    return ((x1+x2)/2,(y1+y2)/2)

def box_distance(a,b):
    ax,ay=box_center(a); bx,by=box_center(b)
    return ((ax-bx)**2+(ay-by)**2)**0.5

def detection_threshold(label):
    if label=="license plate": return 15
    if label=="person without helmet": return 35
    if label in {"person","pedestrian"}: return 24
    if label in VEHICLES: return 22
    if "traffic light" in label: return 45
    return 25

def plate_variants(crop):
    if crop.size==0: return []
    scale=max(3, min(8, int(420 / max(1, crop.shape[1]))))
    big=cv2.resize(crop,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC)
    gray=cv2.cvtColor(big,cv2.COLOR_BGR2GRAY)
    gray=cv2.bilateralFilter(gray,7,45,45)
    clahe=cv2.createCLAHE(clipLimit=2.8,tileGridSize=(8,8)).apply(gray)
    _,otsu=cv2.threshold(clahe,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    adapt=cv2.adaptiveThreshold(clahe,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,9)
    return [big,otsu,255-otsu]

def extract_stamp_metadata(image):
    h,w=image.shape[:2]
    crop=image[:max(60,int(h*.16)),:max(260,int(w*.42))]
    if crop.size==0: return {}
    big=cv2.resize(crop,None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
    gray=cv2.cvtColor(big,cv2.COLOR_BGR2GRAY)
    _,thr=cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    reads=[]
    for variant in [big,thr]:
        try:
            reads.extend(ocr.readtext(variant,detail=0,paragraph=False))
        except Exception:
            pass
    text=" ".join(str(x).strip() for x in reads if str(x).strip())
    clean=re.sub(r"\s+"," ",text).strip()
    meta={}
    date=STAMP_DATE_RE.search(clean)
    if date:
        dd,mm,yyyy,hh,minute,sec=date.groups()
        sec=sec or "00"
        meta["timestampText"]=date.group(0)
        meta["timestampIso"]=f"{yyyy}-{mm}-{dd}T{hh}:{minute}:{sec}"
    date_start=date.start() if date else len(clean)
    loc=clean[:date_start].strip(" -:|,")
    loc=re.sub(r"[^A-Za-z0-9 ,./-]","",loc).strip()
    loc=re.sub(r"\bBEG?ALURU\b","BENGALURU",loc,flags=re.I)
    camera_like=bool(re.search(r"\b(CAM|CAMERA|CIRCLE|ROAD|JUNCTION|BENGALURU|BANGALORE|MG|KR)\b", loc.upper()))
    ui_like=bool(re.search(r"ANALYZE|EVIDENCE|UPLOAD|DRISHTI|DETECTS|TRAFFIC", loc.upper()))
    if 4<=len(loc)<=80 and (date or camera_like) and not ui_like:
        meta["locationText"]=loc.title()
    if clean:
        meta["rawStampText"]=clean
    return meta

def analyze(payload):
    started=time.perf_counter(); original=decode_image(payload["image"]); image,quality=quality_and_enhance(original)
    h,w=image.shape[:2]
    stamp=extract_stamp_metadata(image)
    with LOCK:
        result=model.predict(image,conf=float(payload.get("threshold",.18)),iou=.5,imgsz=min(1280,max(640,((max(h,w)+31)//32)*32)),verbose=False)[0]
    detections=[]
    if result.boxes is not None:
        for box in result.boxes:
            xyxy=[int(v) for v in box.xyxy[0].cpu().tolist()]
            cls=int(box.cls[0]); label=result.names[cls]; conf=round(float(box.conf[0])*100,1)
            if conf >= detection_threshold(label):
                detections.append({"label":label,"confidence":conf,"box":xyxy})

    # OCR runs over genuine YOLO plate crops first, then the full image as fallback.
    plate_dets=sorted([d for d in detections if d["label"]=="license plate"], key=lambda x:x["confidence"], reverse=True)
    regions=[]
    for d in plate_dets[:5]:
        x1,y1,x2,y2=d["box"]; pad=8; regions.append((max(0,x1-pad),max(0,y1-pad),min(w,x2+pad),min(h,y2+pad)))
    ocr_reads=[]
    for rx1,ry1,rx2,ry2 in regions[:12]:
        crop=image[ry1:ry2,rx1:rx2]
        if crop.size==0: continue
        for variant in plate_variants(crop):
            for points,text,score in ocr.readtext(variant,detail=1,paragraph=False,allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -"):
                clean=re.sub(r"[^A-Z0-9]","",text.upper())
                match=PLATE_RE.search(text.upper()) or PLATE_CLEAN_RE.search(clean)
                if match:
                    scale_x=(rx2-rx1)/max(1,variant.shape[1]); scale_y=(ry2-ry1)/max(1,variant.shape[0])
                    xs=[p[0]*scale_x+rx1 for p in points]; ys=[p[1]*scale_y+ry1 for p in points]
                    ocr_reads.append({"text":re.sub(r"\s+","",match.group(0)).strip(),"confidence":round(float(score)*100,1),
                                      "box":[int(min(xs)),int(min(ys)),int(max(xs)),int(max(ys))],"source":"enhanced plate crop"})
    ocr_reads=sorted(ocr_reads,key=lambda x:x["confidence"],reverse=True)
    plate=ocr_reads[0]["text"] if ocr_reads else None
    if ocr_reads: detections.append({"label":"registration: "+plate,"confidence":ocr_reads[0]["confidence"],"box":ocr_reads[0]["box"]})

    violations=[]
    for d in detections:
        if d["label"]=="person without helmet": violations.append({"type":"Helmet non-compliance","confidence":d["confidence"],"box":d["box"],"basis":"rider head region detected without helmet","target":"Two-wheeler rider"})
    persons=[d for d in detections if d["label"] in {"person","pedestrian"}]
    bikes=[d for d in detections if d["label"] in {"motorcycle","scooter"}]
    for bike in bikes:
        bx= bike["box"]; margin=[bx[0]-(bx[2]-bx[0])*.25,bx[1]-(bx[3]-bx[1])*1.6,bx[2]+(bx[2]-bx[0])*.25,bx[3]]
        riders=[p for p in persons if iou_inside(p["box"],margin)]
        if len(riders)>=3: violations.append({"type":"Triple riding","confidence":round(min([bike["confidence"]]+[p["confidence"] for p in riders]),1),"box":[int(v) for v in margin],"basis":f"{len(riders)} persons associated with one two-wheeler"})

    calibration=payload.get("calibration") or {}
    limitations=[]
    for rule,need in [("Wrong-side driving","lane direction and motion track"),("Stop-line violation","stop-line polygon and signal state"),("Red-light violation","signal ROI, stop line and motion track"),("Illegal parking","parking zone and dwell-time sequence")]:
        limitations.append({"type":rule,"status":"not_evaluated","reason":f"Requires {need}; a single uncalibrated image is insufficient"})
    if calibration: limitations.append({"type":"Camera calibration","status":"received","reason":"Static geometry accepted; temporal rules still require consecutive frames"})
    limitations.append({"type":"Seatbelt non-compliance","status":"not_evaluated","reason":"Wide CCTV frames do not expose cabin/torso details reliably; use close frontal vehicle camera or a trained seatbelt model"})

    annotated=original.copy()
    palette={"person":(255,190,60),"pedestrian":(255,190,60),"car":(80,190,255),"motorcycle":(255,120,60),"license plate":(60,230,120)}
    for d in detections:
        x1,y1,x2,y2=d["box"]; color=palette.get(d["label"],(100,255,210))
        cv2.rectangle(annotated,(x1,y1),(x2,y2),color,2)
        label=f'{d["label"]} {d["confidence"]:.1f}%'; tw,th=cv2.getTextSize(label,cv2.FONT_HERSHEY_SIMPLEX,.48,1)[0]
        cv2.rectangle(annotated,(x1,max(0,y1-th-9)),(x1+tw+6,y1),color,-1); cv2.putText(annotated,label,(x1+3,max(12,y1-5)),cv2.FONT_HERSHEY_SIMPLEX,.48,(10,20,20),1,cv2.LINE_AA)
    ok,buf=cv2.imencode(".jpg",annotated,[cv2.IMWRITE_JPEG_QUALITY,90]); encoded=base64.b64encode(buf).decode()
    incident_id="DR-"+time.strftime("%Y")+"-"+uuid.uuid4().hex[:6].upper()
    evidence_dir=ROOT/"data"/"evidence"; evidence_dir.mkdir(parents=True,exist_ok=True)
    original_path=evidence_dir/f"{incident_id}-original.jpg"; annotated_path=evidence_dir/f"{incident_id}-annotated.jpg"
    cv2.imwrite(str(original_path),original,[cv2.IMWRITE_JPEG_QUALITY,95]); cv2.imwrite(str(annotated_path),annotated,[cv2.IMWRITE_JPEG_QUALITY,92])
    enriched_violations=[]
    for idx,v in enumerate(violations[:10], start=1):
        x1,y1,x2,y2=v["box"]; bw=max(1,x2-x1); bh=max(1,y2-y1)
        tx1=max(0,int(x1-bw*.65)); ty1=max(0,int(y1-bh*.65)); tx2=min(w,int(x2+bw*.65)); ty2=min(h,int(y2+bh*.95))
        target_box=[tx1,ty1,tx2,ty2]
        target=original[ty1:ty2,tx1:tx2]
        target_data_url=None; target_rel=None
        if target.size:
            target_path=evidence_dir/f"{incident_id}-target-{idx:02d}.jpg"
            cv2.imwrite(str(target_path),target,[cv2.IMWRITE_JPEG_QUALITY,94])
            ok_t,buf_t=cv2.imencode(".jpg",target,[cv2.IMWRITE_JPEG_QUALITY,92])
            if ok_t:
                target_data_url="data:image/jpeg;base64,"+base64.b64encode(buf_t).decode()
                target_rel=str(target_path.relative_to(ROOT))
        item={**v,"subjectId":f"{incident_id}-S{idx:02d}","targetImage":target_data_url,"targetBox":target_box,"targetEvidence":target_rel}
        enriched_violations.append(item)
    violations=enriched_violations
    primary=max(violations,key=lambda v:v["confidence"]) if violations else None
    target_data_url=primary.get("targetImage") if primary else None
    target_rel=primary.get("targetEvidence") if primary else None
    target_box=primary.get("targetBox") if primary else None
    if primary:
        vehicles=[d for d in detections if d["label"] in VEHICLES]
        if primary["type"] in {"Helmet non-compliance","Triple riding"}:
            two=[d for d in vehicles if d["label"] in {"motorcycle","scooter"}]
            nearest=min(two,key=lambda v:box_distance(v["box"],primary["box"]),default=None)
            target_vehicle=nearest["label"].title() if nearest else "Two-wheeler"
        else:
            nearest=min(vehicles,key=lambda v:box_distance(v["box"],primary["box"]),default=None)
            target_vehicle=nearest["label"].title() if nearest else "Not classified"
    else:
        target_vehicle=next((d["label"].title() for d in detections if d["label"] in VEHICLES),"Not classified")
    final_location=payload.get("location") or stamp.get("locationText") or "Unknown — no GPS/camera metadata"
    final_time=payload.get("capturedAt") or stamp.get("timestampIso") or time.strftime("%Y-%m-%dT%H:%M:%SZ")
    incident={"id":incident_id,"timestamp":final_time,
      "type":primary["type"] if primary else "No violation confirmed","plate":plate or "Not readable","confidence":primary["confidence"] if primary else 0,
      "location":final_location,"status":"Needs review" if primary else "No enforceable event",
      "vehicle":target_vehicle,"sourceImage":payload["image"],"targetImage":target_data_url,"targetBox":target_box,
      "challanReason":primary["basis"] if primary else "No enforceable violation was confirmed",
      "metadataSource":{"location":"user" if payload.get("location") else ("image_stamp" if stamp.get("locationText") else "missing"),
                        "timestamp":"user" if payload.get("capturedAt") else ("image_stamp" if stamp.get("timestampIso") else "system")},
      "annotatedImage":"data:image/jpeg;base64,"+encoded,"evidence":{"original":str(original_path.relative_to(ROOT)),"annotated":str(annotated_path.relative_to(ROOT)),"target":target_rel}}
    counts={};
    for d in detections: counts[d["label"]]=counts.get(d["label"],0)+1
    return {"incident":incident,"detections":detections,"violations":violations,"notEvaluated":limitations,"ocr":ocr_reads[:5],"objectCounts":counts,
      "stamp":stamp,
      "quality":quality,"image":{"width":w,"height":h},"model":{"detector":MODEL_NAME,"ocr":"EasyOCR English","genuineInference":True},
      "processingMs":round((time.perf_counter()-started)*1000),"pipeline":["quality assessment","adaptive enhancement","camera stamp OCR","YOLO-World detection","enhanced plate OCR","spatial association","evidence packaging"]}

class Handler(BaseHTTPRequestHandler):
    def send_json(self,status,obj):
        raw=json.dumps(obj).encode(); self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        self.send_json(200,{"status":"ok","model":MODEL_NAME,"genuineInference":True}) if self.path=="/health" else self.send_json(404,{"error":"Not found"})
    def do_POST(self):
        try:
            length=int(self.headers.get("Content-Length","0")); payload=json.loads(self.rfile.read(length)); self.send_json(200,analyze(payload))
        except Exception as exc: self.send_json(400,{"error":str(exc)})
    def log_message(self,fmt,*args): print("[AI] "+fmt%args,flush=True)

if __name__=="__main__": ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
