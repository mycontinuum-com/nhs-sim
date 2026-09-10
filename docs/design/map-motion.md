# Map motion

The neighbourhood uses a Veo 3.1 video generated from the existing fictional map. Vehicles stay parked while river ripples, foliage and small pedestrian movements animate the scene. Two traffic-focused versions were rejected because vehicles changed shape or became oversized buses. The selected calmer generation keeps the vehicles consistent in the reviewed frames.

Each location has an eased camera move over the animated map and an exact reversed clip. Direct Veo camera generations changed landmarks, so these moves use ffmpeg to preserve the map. The camera eases in and out with zero velocity and acceleration at both ends. The final close-up stays behind the phone or desktop until you leave. Both zoom-in and return take 0.7 seconds and can be skipped. Background motion pauses while a launcher or another dialog is open, or the tab is hidden. Reduced-motion users get the static map and immediate navigation.

## Reproduce

Requires Python, ffmpeg, AWS CLI authenticated with the default profile, and `google-genai` plus Pillow installed in a Python virtual environment. The generator reads the Gemini key from AWS SSM in memory. It never writes the key to a file or sends it to the browser.

```sh
python scripts/generate-map-video.py prepare
python scripts/generate-map-video.py submit neighbourhood-calm-loop
python scripts/generate-map-video.py poll neighbourhood-calm-loop
python scripts/render-map-video.py neighbourhood-calm-loop
```

Submission creates a paid generation. Existing operation records prevent duplicate submissions. Poll until the result reports downloaded. Working files and operation records stay in ignored `.verification/veo/`. Use a new `neighbourhood-` name for a deliberate new generation.

The checked-in MP4 files contain no audio. `map-motion.json` records the prompt, model and output hashes. The browser serves these files locally through `/control/world/`; it makes no requests to Gemini.
