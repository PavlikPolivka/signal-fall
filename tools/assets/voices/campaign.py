#!/usr/bin/env python3
"""Campaign voices: briefings and mission lines, spoken by the three sides.

    python3 tools/assets/voices/campaign.py     # needs piper-tts and ffmpeg (see build.py); reads campaign.json

Writes apps/client/public/assets/voice/campaign/<mission>/brief_<n>.mp3 and line_<n>.mp3. Existing files are kept
(FORCE=1 rebuilds). Varga is a woman on a field radio; WREN and HALCYON speak through the synthetic treatment;
the Cantor through the chorus.
"""
import json
import os
import subprocess
import tempfile

from build import CACHE, TREATMENT, model, piper_bin  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'client', 'public', 'assets', 'voice', 'campaign')

# speaker: (piper voice, pace, treatment)
SPEAKERS = {
    'holdout': ('en_US/ljspeech/high/en_US-ljspeech-high', 0.98, 'holdout'),
    'halcyon': ('en_GB/cori/high/en_GB-cori-high', 1.05, 'halcyon'),
    'choir': ('en_US/ljspeech/high/en_US-ljspeech-high', 1.15, 'choir'),
}


def main():
    missions = json.load(open(os.path.join(HERE, 'campaign.json')))
    piper = piper_bin()
    with tempfile.TemporaryDirectory() as tmp:
        for m in missions:
            out_dir = os.path.join(OUT, m['id'])
            os.makedirs(out_dir, exist_ok=True)
            items = [(f'brief_{i}', x) for i, x in enumerate(m['brief'])] + [(f'line_{i}', x) for i, x in enumerate(m['lines'])]
            for name, item in items:
                dest = os.path.join(out_dir, f'{name}.mp3')
                if os.path.exists(dest) and not os.environ.get('FORCE'):
                    continue
                voice, pace, treat = SPEAKERS[item['speaker']]
                raw = os.path.join(tmp, f"{m['id']}-{name}.wav")
                subprocess.run([piper, '-m', model(voice), '--length-scale', str(pace), '-f', raw], input=item['text'].encode(), check=True, capture_output=True)
                graph = TREATMENT[treat] + ';[out]loudnorm=I=-16:TP=-1.5:LRA=7[final]'
                subprocess.run(
                    ['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[final]',
                     '-ac', '1', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '40k', dest],
                    check=True,
                )
                print(m['id'], name, os.path.getsize(dest) // 1024, 'KB')


if __name__ == '__main__':
    main()
