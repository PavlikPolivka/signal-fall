#!/usr/bin/env python3
"""Announcer voices: Piper TTS (public-domain voices) + an ffmpeg treatment per faction.

    python3 tools/assets/voices/build.py            # needs: pip install piper-tts, and ffmpeg

Writes apps/client/public/assets/voice/<faction>/<line>.mp3. Voice models are downloaded once
into ~/.cache/signal-fall-voices. All three voices were trained from scratch on public-domain
recordings (LibriVox, LJ Speech), so the output carries no license strings.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'client', 'public', 'assets', 'voice')
CACHE = os.path.expanduser('~/.cache/signal-fall-voices')
HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/'

# faction: (piper voice path, pace (length scale; > 1 is slower), speaker settings)
VOICES = {
    # A gruff field-radio operator.
    'holdout': ('en_US/norman/medium/en_US-norman-medium', 0.95),
    # Calm and precise; a little synthetic.
    'halcyon': ('en_GB/cori/high/en_GB-cori-high', 1.08),
    # Slow, layered into a chord.
    'choir': ('en_US/ljspeech/high/en_US-ljspeech-high', 1.15),
}

# The treatment: an ffmpeg filter graph from [0:a] (the voice) to [out].
TREATMENT = {
    # Radio: telephone band, compression, a little grit, squelch clicks before and after.
    'holdout': (
        'anoisesrc=d=0.07:c=pink:a=0.35,highpass=f=900,lowpass=f=3000,volume=0.6[c1];'
        'anoisesrc=d=0.09:c=pink:a=0.3,highpass=f=900,lowpass=f=3000,volume=0.5[c2];'
        '[0:a]highpass=f=330,lowpass=f=3300,acompressor=threshold=-20dB:ratio=5:attack=4:release=80,'
        'acrusher=bits=11:mix=0.2,volume=1.5[v];'
        '[c1][v][c2]concat=n=3:v=0:a=1[out]'
    ),
    # Synthetic: a ring-modulated shadow under the voice, a short metallic echo.
    'halcyon': (
        '[0:a]asplit=2[a][b];[b]afreqshift=shift=-55,volume=0.35[b2];'
        '[a][b2]amix=inputs=2:normalize=0,aecho=0.8:0.55:17|33:0.3|0.2,highpass=f=140,'
        'acompressor=threshold=-18dB:ratio=3,volume=1.2[out]'
    ),
    # Chorus: the voice with a fourth below and a fifth above, wide echo.
    'choir': (
        '[0:a]asplit=3[a][b][c];[b]rubberband=pitch=0.749,volume=0.55[b2];[c]rubberband=pitch=1.498,volume=0.32[c2];'
        '[a][b2][c2]amix=inputs=3:normalize=0,aecho=0.8:0.82:70|140:0.32|0.22,'
        'chorus=0.6:0.9:50|60:0.3|0.25:0.3|0.4:2|2.3,highpass=f=90,volume=1.25[out]'
    ),
}


def model(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, os.path.basename(path) + '.onnx')
    for ext in ('.onnx', '.onnx.json'):
        dest = local[: -len('.onnx')] + ext
        if not os.path.exists(dest):
            print('downloading', os.path.basename(dest))
            urllib.request.urlretrieve(HF + path + ext, dest)
    return local


def piper_bin():
    exe = shutil.which('piper') or os.path.join(os.path.dirname(sys.executable), 'piper')
    if not os.path.exists(exe):
        sys.exit('piper not found: pip install piper-tts')
    return exe


def main():
    lines = json.load(open(os.path.join(HERE, 'lines.json')))
    piper = piper_bin()
    with tempfile.TemporaryDirectory() as tmp:
        for faction, (path, pace) in VOICES.items():
            onnx = model(path)
            out_dir = os.path.join(OUT, faction)
            os.makedirs(out_dir, exist_ok=True)
            for line_id, text in {**lines['common'], **lines[faction], **lines['acks'][faction]}.items():
                dest = os.path.join(out_dir, f'{line_id}.mp3')
                # Existing lines are kept (FORCE=1 rebuilds everything).
                if os.path.exists(dest) and not os.environ.get('FORCE'):
                    continue
                raw = os.path.join(tmp, f'{faction}-{line_id}.wav')
                subprocess.run([piper, '-m', onnx, '--length-scale', str(pace), '-f', raw], input=text.encode(), check=True, capture_output=True)
                graph = TREATMENT[faction] + ';[out]silenceremove=stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB,loudnorm=I=-16:TP=-1.5:LRA=7[final]'
                subprocess.run(
                    ['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[final]',
                     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', dest],
                    check=True,
                )
                print(faction, line_id, os.path.getsize(dest) // 1024, 'KB')


if __name__ == '__main__':
    main()
