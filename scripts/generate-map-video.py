"""Generate resumable Veo map assets. Install google-genai; credentials stay in memory."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.verification/veo'
SOURCE = ROOT / 'apps/control/public/world/neighbourhood-v2.5f600ac647e4.webp'
PLACES = {'practice': (23, 44), 'hospital': (75, 39), 'community': (49, 64), 'pharmacy': (37, 79), 'home': (17, 73)}
BASE = 'Preserve the exact illustrated English healthcare neighbourhood, every building, road, river, colour and architectural detail. No text, titles, logos, new buildings or scene cuts. The cream vertical side borders remain flat and unchanged. Silent scene. '
LOOP = 'Preserve the exact illustrated English healthcare neighbourhood, every building, road, river, colour and architectural detail. No text, titles, logos, new buildings or scene cuts. The cream vertical side borders remain flat and unchanged. Silent scene. Create a lived-in animated miniature English town, with clearly visible continuous everyday activity throughout the entire eight seconds. Several small cars and two buses drive smoothly along the EXISTING roads, keep to the left and follow curves and the roundabout. Tiny pedestrians walk steadily along pavements, across the marked crossings, into the hospital entrance, and along the riverside footpath. A distinctive yellow-and-green ambulance drives briskly and smoothly around the existing roundabout and along the hospital access road with clearly visible alternating BLUE roof beacon lights flashing locally on the small vehicle. It is the liveliest moving element; other cars make room naturally. The blue flashes never illuminate the whole scene. River water ripples and a small boat glides slowly. Trees sway gently. These movements must be noticeable at a wide view while remaining calm, natural and appropriately miniature. Buildings, road geometry and all landmarks remain completely fixed. Locked tripod camera: absolutely no pan, tilt, zoom, reframing or perspective change. Single continuous illustrated scene, no fades or dissolves, no vehicles leaving roads or passing through buildings. Warm afternoon atmosphere. Seamless cyclical motion, return exactly to the provided first frame at the end. No dramatic events.'


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)],check=True)

def prepare():
    WORK.mkdir(parents=True,exist_ok=True)
    ffmpeg('-i', SOURCE, '-vf', 'scale=1620:1080,pad=1920:1080:150:0:color=0xEEE6D4', '-frames:v', '1', WORK/'map-frame.png')
    for place,(x,y) in PLACES.items():
        width,height=668,446
        left=max(0,min(1536-width,round(1536*x/100-width/2)))
        top=max(0,min(1024-height,round(1024*y/100-height/2)))
        ffmpeg('-i',SOURCE,'-vf',f'crop={width}:{height}:{left}:{top},scale=1620:1080,pad=1920:1080:150:0:color=0xEEE6D4','-frames:v','1',WORK/f'{place}-frame.png')

def prompt_for(name):
    if name.startswith('neighbourhood-'): return LOOP
    place=name.removeprefix('zoom-')
    return BASE + f'A smooth, gentle camera push-in from the provided wide aerial map to the exact provided close-up of the {place} location. Follow a direct gradual optical zoom and translation, no camera rotation and no changing viewing angle. Keep the hand-drawn map texture and all landmarks rigidly consistent. Begin at the exact first frame, ease smoothly toward the exact last frame, and settle completely for the final second. No morphing, melting, dissolves, fades or added content. The only movement is the camera and very subtle river and foliage motion.'

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['prepare','submit','poll'])
    parser.add_argument('names',nargs='*')
    args=parser.parse_args()
    if args.command=='prepare': prepare(); return
    raw=subprocess.check_output(['aws','ssm','get-parameter','--profile','default','--region','eu-west-2','--name','PROD_GEMINI_API_KEY','--with-decryption','--output','json'])
    key=json.loads(raw)['Parameter']['Value']
    client=genai.Client(api_key=key)
    names=args.names or ['neighbourhood-active-loop']
    def run(name):
        record=WORK/f'{name}.json'
        if args.command=='submit':
            if record.exists(): return {'name':name,'status':'already submitted'}
            model='veo-3.1-generate-preview' if name.startswith('neighbourhood-') else 'veo-3.1-fast-generate-preview'
            last='map' if name.startswith('neighbourhood-') else name.removeprefix('zoom-')
            operation=client.models.generate_videos(model=model,source=types.GenerateVideosSource(prompt=prompt_for(name),image=types.Image.from_file(location=str(WORK/'map-frame.png'))),config=types.GenerateVideosConfig(number_of_videos=1,duration_seconds=8,aspect_ratio='16:9',resolution='1080p',last_frame=types.Image.from_file(location=str(WORK/f'{last}-frame.png'))))
            record.write_text(json.dumps({'name':name,'operation':operation.name,'model':model,'prompt':prompt_for(name)},indent=2))
            return {'name':name,'status':'submitted'}
        if not record.exists(): return {'name':name,'status':'not submitted'}
        if (WORK/f'{name}-raw.mp4').exists(): return {'name':name,'status':'downloaded'}
        saved=json.loads(record.read_text())
        operation=client.operations.get(types.GenerateVideosOperation(name=saved['operation']))
        if not operation.done: return {'name':name,'status':'generating'}
        if operation.error: return {'name':name,'status':'failed','error':operation.error}
        if not operation.response or not operation.response.generated_videos: return {'name':name,'status':'no video returned'}
        video=operation.response.generated_videos[0].video
        client.files.download(file=video)
        video.save(str(WORK/f'{name}-raw.mp4'))
        return {'name':name,'status':'downloaded'}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(run,names): print(json.dumps(result),flush=True)

if __name__=='__main__': main()
