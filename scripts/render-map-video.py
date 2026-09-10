"""Render a seamless loop and geometrically exact camera moves from a Veo source."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'.verification/veo'
OUT=ROOT/'apps/control/public/world'
REFERENCE='apps/control/public/world/neighbourhood-v2.5f600ac647e4.webp'
PLACES={'practice':(.23,.44),'hospital':(.75,.39),'community':(.49,.64),'pharmacy':(.37,.79),'home':(.17,.73)}
def encode(source,filters,destination,complex_filter=False):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),*(['-filter_complex',filters,'-map','[out]'] if complex_filter else ['-vf',filters]),'-an','-c:v','libx264','-threads','3','-preset','slow','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',str(destination)],check=True)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('source',help='Generation name, without -raw.mp4');parser.add_argument('--camera-only',action='store_true');args=parser.parse_args()
    source=WORK/f'{args.source}-raw.mp4'
    loop=OUT/'neighbourhood-loop.mp4'
    if not args.camera_only: encode(source,'[0:v]crop=1620:1080:150:0,scale=1440:960,setsar=1,split[a][b];[a]trim=start=0.5,setpts=PTS-STARTPTS[main];[b]trim=end=0.5,setpts=PTS-STARTPTS[start];[main][start]xfade=transition=fade:duration=0.5:offset=7[out]',loop,True)
    def camera(item):
        place,(cx,cy)=item
        zoom=2.3
        x=max(0,min(1,(cx-.5/zoom)/(1-1/zoom)))
        y=max(0,min(1,(cy-.5/zoom)/(1-1/zoom)))
        t='min(on/119,1)'
        z=f'1+1.3*(6*pow({t},5)-15*pow({t},4)+10*pow({t},3))'
        forward=OUT/f'zoom-{place}.mp4'
        filters=f"trim=duration=6,scale=2880:1920,zoompan=z='{z}':x='(iw-iw/zoom)*{x}':y='(ih-ih/zoom)*{y}':d=1:s=1080x720:fps=24,setsar=1"
        encode(loop,filters,forward)
        encode(forward,'reverse,setpts=PTS-STARTPTS',OUT/f'return-{place}.mp4')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-sseof','-0.05','-i',str(forward),'-frames:v','1','-q:v','2',str(OUT/f'arrived-{place}.jpg')],check=True)
        return place
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for place in pool.map(camera,PLACES.items()): print('Rendered',place,flush=True)
    meta=json.loads((WORK/f'{args.source}.json').read_text())
    files=[loop,*[OUT/f'{direction}-{place}.mp4' for place in PLACES for direction in ['zoom','return']],*[OUT/f'arrived-{place}.jpg' for place in PLACES]]
    manifest={'model':meta['model'],'prompt':meta['prompt'],'reference':REFERENCE,'generationScript':'scripts/generate-map-video.py','renderCommand':f'python3 scripts/render-map-video.py {args.source}','treatment':'Half-second loop seam blend. Quintic easing starts and finishes with zero velocity and acceleration. Arrival frames hold the close-up behind the launcher. Precise eased camera moves over generated footage; reverse clips retrace the same frames. Direct Veo zoom attempts rejected after visual review because some changed landmarks or dissolved between views.','assets':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    (ROOT/'docs/design/map-motion.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Saved map motion manifest',flush=True)
if __name__=='__main__':main()
