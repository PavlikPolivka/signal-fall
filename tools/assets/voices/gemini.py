#!/usr/bin/env python3
"""Voices with Gemini text-to-speech: the announcer (lines.json) and the campaign (campaign.json).

    python3 tools/assets/voices/gemini.py [announcer|campaign] [ids...]    # needs ffmpeg

Casting and spoken directions are in gemini.json. Each line is generated once into
tools/assets/build/voices-gemini/ (git ignores it; FORCE=1 or naming ids makes them again), transcribed back with
a Gemini text model and compared with the script (a take that drops or adds words is made again, up to three
times), then given its faction treatment from build.py and written over the game's mp3.
The API key comes from the macOS keychain (service "gemini-api", account "signal-fall") or GEMINI_API_KEY.
"""
import base64
import difflib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from build import TREATMENT  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'client', 'public', 'assets', 'voice')
RAW = os.path.join(ROOT, 'tools', 'assets', 'build', 'voices-gemini')
CFG = json.load(open(os.path.join(HERE, 'gemini.json')))
API = 'https://generativelanguage.googleapis.com/v1beta/models/'


def api_key():
    if os.environ.get('GEMINI_API_KEY'):
        return os.environ['GEMINI_API_KEY']
    return subprocess.run(['security', 'find-generic-password', '-s', 'gemini-api', '-a', 'signal-fall', '-w'], check=True, capture_output=True, text=True).stdout.strip()


KEY = api_key()


def call(model, body):
    for attempt in range(6):
        req = urllib.request.Request(API + model + ':generateContent', data=json.dumps(body).encode(), headers={'x-goog-api-key': KEY, 'Content-Type': 'application/json'})
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f'{e.code}: {e.read()[:300]!r}') from e
    raise RuntimeError('unreachable')


def speak(text, cast):
    body = {
        # Director's notes apart from the transcript: a bare "Say X:" cue gets read aloud on short lines, and
        # long cues make the model drawl.
        'contents': [{'parts': [{'text': f"# AUDIO PROFILE\n{cast['profile']}\n\n## DIRECTOR'S NOTES\nStyle: {cast['style']}.\nPace: {cast.get('pace', 'natural, not slow')}.\n\n## TRANSCRIPT\n{text}"}]}],
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': cast['voice']}}}},
    }
    part = call(CFG['model'], body)['candidates'][0]['content']['parts'][0]['inlineData']
    return base64.b64decode(part['data'])


def words(s):
    # Transcripts sometimes carry timestamps ("00:08"); names come back as sound-alikes (WREN, "Ren").
    s = re.sub(r'\b\d+:\d+(\.\d+)?\b', ' ', s)
    return re.sub(r'[^a-z0-9 ]', ' ', s.lower().replace('-', ' ')).split()


def heard(wav):
    body = {'contents': [{'parts': [
        {'inlineData': {'mimeType': 'audio/wav', 'data': base64.b64encode(wav).decode()}},
        {'text': 'Transcribe this audio exactly, word for word. Write numbers as words. Reply with the transcript only, no timestamps.'},
    ]}]}
    return call(CFG['check_model'], body)['candidates'][0]['content']['parts'][0]['text']


def matches(text, wav):
    a, b = words(text), words(heard(wav))
    # Close enough: a dropped or invented phrase fails, a misheard name does not.
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.85, b


def take(name, text, cast):
    raw = os.path.join(RAW, name + '.wav')
    if os.path.exists(raw) and not os.environ.get('FORCE') and not FORCED:
        return open(raw, 'rb').read()
    for attempt in range(3):
        wav = speak(text, cast)
        ok, got = matches(text, wav)
        if ok:
            break
        print(f'  retake {name}: heard "{" ".join(got)}"')
    else:
        print(f'  KEPT A MISMATCH for {name}: check it by ear')
    os.makedirs(os.path.dirname(raw), exist_ok=True)
    open(raw, 'wb').write(wav)
    return wav


def treat(raw_path, dest, treatment, rate, bitrate):
    graph = TREATMENT[treatment] + ';[out]silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.35:stop_threshold=-45dB,loudnorm=I=-16:TP=-1.5:LRA=7[final]'
    subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-y', '-i', raw_path, '-filter_complex', graph, '-map', '[final]', '-ac', '1', '-ar', str(rate), '-c:a', 'libmp3lame', '-b:a', bitrate, dest],
        check=True,
    )


def jobs(kind):
    if kind == 'announcer':
        lines = json.load(open(os.path.join(HERE, 'lines.json')))
        for faction in ('holdout', 'halcyon', 'choir'):
            for line_id, text in {**lines['common'], **lines[faction], **lines['acks'][faction]}.items():
                yield f'announcer/{faction}/{line_id}', text, CFG['announcer'][faction], faction, os.path.join(OUT, faction, f'{line_id}.mp3'), 44100, '64k'
    else:
        for m in json.load(open(os.path.join(HERE, 'campaign.json'))):
            items = [(f'brief_{i}', x) for i, x in enumerate(m['brief'])] + [(f'line_{i}', x) for i, x in enumerate(m['lines'])]
            for name, item in items:
                yield f"campaign/{m['id']}/{name}", item['text'], CFG['campaign'][item['speaker']], item['speaker'], os.path.join(OUT, 'campaign', m['id'], f'{name}.mp3'), 32000, '40k'


kinds = [a for a in sys.argv[1:] if a in ('announcer', 'campaign')] or ['campaign', 'announcer']
only = [a for a in sys.argv[1:] if a not in ('announcer', 'campaign')]
FORCED = bool(only)
for kind in kinds:
    for name, text, cast, treatment, dest, rate, bitrate in jobs(kind):
        if only and not any(name.startswith(f'{kind}/{o}') or o in name for o in only):
            continue
        take(name, text, cast)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        treat(os.path.join(RAW, name + '.wav'), dest, treatment, rate, bitrate)
        print(name, os.path.getsize(dest) // 1024, 'KB')
