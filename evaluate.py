"""Compute classification metrics for exported Drishti evaluation JSON.

Input format: a JSON array with {"truth": "class", "prediction": "class"}.
Run: .venv/Scripts/python evaluate.py evaluation_records.json
Detection mAP is evaluated separately with `yolo val` on a labeled YOLO dataset.
"""
import json, sys, time
from collections import Counter

def evaluate(rows):
    labels=sorted({r["truth"] for r in rows}|{r["prediction"] for r in rows})
    metrics={}; total_correct=0
    for label in labels:
        tp=sum(r["truth"]==label and r["prediction"]==label for r in rows)
        fp=sum(r["truth"]!=label and r["prediction"]==label for r in rows)
        fn=sum(r["truth"]==label and r["prediction"]!=label for r in rows)
        precision=tp/(tp+fp) if tp+fp else 0; recall=tp/(tp+fn) if tp+fn else 0
        metrics[label]={"precision":round(precision,4),"recall":round(recall,4),"f1":round(2*precision*recall/(precision+recall),4) if precision+recall else 0,"support":tp+fn}
        total_correct+=tp
    macro={k:round(sum(v[k] for v in metrics.values())/len(metrics),4) if metrics else 0 for k in ("precision","recall","f1")}
    return {"samples":len(rows),"accuracy":round(total_correct/len(rows),4) if rows else 0,"macro":macro,"perClass":metrics}

if __name__=="__main__":
    if len(sys.argv)!=2: raise SystemExit("Usage: python evaluate.py evaluation_records.json")
    with open(sys.argv[1],encoding="utf8") as f: rows=json.load(f)
    print(json.dumps(evaluate(rows),indent=2))
