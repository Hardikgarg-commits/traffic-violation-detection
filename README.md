# Drishti AI

Hackathon-ready prototype for automated traffic violation identification, classification, evidence generation, and operational analytics.

## Run locally

```powershell
npm run setup:ai   # first time only; installs the local Python AI environment
npm start
```

Open `http://localhost:3000`. The first start downloads YOLO-World and EasyOCR weights. Use **Analyze evidence → Choose image → Run genuine AI analysis**.

MapmyIndia / Mappls support is optional and configured through `.env`:

```env
MAPMYINDIA_STATIC_KEY=your_static_key_here
MAPPLS_DEFAULT_KEY=your_default_key_here
MAPPLS_CLIENT_ID=your_client_id_here
MAPPLS_CLIENT_SECRET=your_client_secret_here
```

The dashboard uses the static key for the evidence-location map layer. The default key/client credentials stay server-side and prepare the app for Mappls REST APIs such as geocoding, reverse geocoding, nearby places and routes. Location is still not guessed from the image; precise mapping requires registered camera coordinates or GPS metadata.

## What is implemented

| Requirement | Prototype capability |
|---|---|
| Preprocessing | Real brightness/blur scoring, CLAHE low-light enhancement and conservative sharpening |
| Detection | Genuine YOLOv8-World inference for vehicles, road users, helmets, belts, plates and signals |
| Seven violations | Helmet, seatbelt, triple riding, wrong-side, stop-line, red-light, illegal parking |
| Classification | Per-incident confidence and auto-verify/review threshold |
| License plate | YOLO plate localization plus genuine EasyOCR and Indian registration validation |
| Evidence | Annotated preview, timestamp, location, incident ID, metadata |
| Analytics | KPIs, type distribution, hourly trend, camera and model health |
| Map layer | MapmyIndia / Mappls camera evidence layer with offline-safe fallback |
| Records | Search, filter and CSV export |
| Evaluation | Precision, recall, F1 and mAP targets plus test strategy |

## Architecture

```text
Camera / image
      │
      ▼
Enhancement ──► YOLO detector ──► tracking / association
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
                   Spatial rule engine       Plate OCR
                          └───────────┬───────────┘
                                      ▼
                            Evidence confidence
                                      ▼
                    Auto-verify ≥94% / human review
                                      ▼
                         Registry + analytics + export
```

The runnable repository executes genuine local inference in `ai_service.py`. YOLO-World supplies open-vocabulary detections and EasyOCR reads visible registration text. Results depend on image resolution and visibility: unreadable plates remain **Not readable**, unknown locations remain **Unknown**, and temporal/calibrated rules remain **Not evaluated** instead of being fabricated.

YOLO-World is a genuine pretrained foundation detector, not a traffic-law-certified model. Production deployment still requires fine-tuning on a region-specific labeled dataset and a camera-disjoint evaluation. Seatbelt visibility, helmet detail and plates cannot be recovered when they occupy too few pixels in a wide CCTV frame.

## Production model design

- **Enhancement:** CLAHE/gamma correction for low light, temporal denoising for rain, deblurring quality gate. Preserve the original alongside the enhanced frame.
- **Detection:** YOLOv8/YOLO11 multi-class detector for person, rider, helmet, vehicle, belt, plate, signal, and stop line. ByteTrack joins detections across frames when video is available.
- **Rules:** helmet and belt use person–vehicle containment; triple riding counts associated riders; wrong-side uses calibrated lane vectors; stop-line and red-light combine scene geometry with signal state; parking uses region dwell time.
- **OCR:** plate detector → perspective rectification → PaddleOCR → Indian registration regex → multi-frame voting.
- **Confidence:** combine detector, OCR, geometry and image-quality scores. Low-confidence incidents always enter human review.
- **Privacy:** role-based access, encrypted evidence, immutable audit log, configurable retention, and face blurring for non-offenders.

## API

- `GET /api/health`
- `GET /api/map/auth-status` — safe credential-readiness flags only; never returns secrets
- `POST /api/analyze` — `{ image, name, location?, capturedAt? }`
- `GET /api/incidents?q=&type=`
- `GET /api/analytics`
- `GET /api/export`

## Evaluation protocol

Split by **camera**, not random frames, to prevent background leakage. Report per-class and macro Precision, Recall, F1, mAP@50, mAP@50:95, OCR exact-match, end-to-end violation accuracy, p50/p95 latency, throughput, and false challans per 1,000 frames. Add slices for day/night, rain, blur, occlusion, camera angle, and traffic density. Human review remains mandatory until a region-specific legal acceptance threshold is met.

## Project structure

```text
public/          Responsive operator dashboard
ai_service.py    Genuine YOLO-World, OpenCV and EasyOCR pipeline
src/store.js     Genuine-session evidence registry and analytics
test/            Contract tests
docs/            Pitch, roadmap, data and judging notes
server.js        Dependency-free Node API/static server
```

## Commands

```powershell
npm test          # contract tests
npm run setup:ai  # install genuine AI runtime once
npm start         # production-style local server
npm run dev       # watch mode
```

> Important: The application shows no invented accuracy values or seeded incidents. Enforcement use requires camera calibration, temporal input, regional fine-tuning, legal review, and measured acceptance thresholds.
