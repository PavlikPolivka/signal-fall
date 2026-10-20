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


class DailyQuota(Exception):
    """The key's requests for today are used up: stop, and run again tomorrow (finished lines are kept)."""


def call(model, body):
    for attempt in range(12):
        req = urllib.request.Request(API + model + ':generateContent', data=json.dumps(body).encode(), headers={'x-goog-api-key': KEY, 'Content-Type': 'application/json'})
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            text = e.read()
            if e.code == 429:
                err = json.loads(text).get('error', {})
                ids = [v.get('quotaId', '') for d in err.get('details', []) for v in d.get('violations', [])]
                if any('PerDay' in q for q in ids):
                    raise DailyQuota(f'{model}: {ids}') from e
                # A per-minute limit: wait as long as the API asks.
                delay = next((d.get('retryDelay') for d in err.get('details', []) if 'retryDelay' in d), '20s')
                time.sleep(float(str(delay).rstrip('s')) + 2)
                continue
            if e.code in (500, 503) and attempt < 11:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f'{e.code}: {text[:300]!r}') from e
    raise RuntimeError('still rate limited after 12 tries')


def as_wav(data, mime):
    # Some models send raw 16-bit PCM ("audio/L16;codec=pcm;rate=24000"): give it a WAV header.
    if data[:4] == b'RIFF':
        return data
    rate = int(re.search(r'rate=(\d+)', mime or '').group(1)) if re.search(r'rate=(\d+)', mime or '') else 24000
    import struct
    return b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16) + b'data' + struct.pack('<I', len(data)) + data


def speak(text, cast, model=None):
    body = {
        # Director's notes apart from the transcript: a bare "Say X:" cue gets read aloud on short lines, and
        # long cues make the model drawl.
        'contents': [{'parts': [{'text': f"# AUDIO PROFILE\n{cast['profile']}\n\n## DIRECTOR'S NOTES\nStyle: {cast['style']}.\nPace: {cast.get('pace', 'natural, not slow')}.\n\n## TRANSCRIPT\n{text}"}]}],
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': cast['voice']}}}},
    }
    part = call(model or CFG['model'], body)['candidates'][0]['content']['parts'][0]['inlineData']
    return as_wav(base64.b64decode(part['data']), part.get('mimeType'))


def words(s):
    # Transcripts sometimes carry timestamps ("00:08"); names come back as sound-alikes (WREN, "Ren").
    s = re.sub(r'\b\d+:\d+(\.\d+)?\b', ' ', s)
    out = re.sub(r'[^a-z0-9 ]', ' ', s.lower().replace('-', ' ')).split()
    return ['wren' if w == 'ren' else w for w in out]


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


def seconds(wav):
    # 24 kHz, 16-bit mono PCM after a 44-byte header.
    return max(0, len(wav) - 44) / 48000


def plausible(text, wav):
    # The transcript can leave out what was read by mistake (the director's notes, read aloud): a take
    # far longer than its words need is that, whatever the transcript says.
    return seconds(wav) <= 2.5 + 0.75 * len(words(text))


def take(name, text, cast, model=None):
    raw = os.path.join(RAW, name + '.wav')
    if os.path.exists(raw) and not os.environ.get('FORCE') and not FORCED:
        return open(raw, 'rb').read()
    for attempt in range(3):
        wav = speak(text, cast, model)
        if not plausible(text, wav):
            print(f'  retake {name}: {seconds(wav):.1f} s is too long for the line')
            continue
        ok, got = matches(text, wav)
        if ok:
            break
        print(f'  retake {name}: heard "{" ".join(got)}"')
    else:
        # No good take: keep whatever the game has now (the old voice) and list the line to try again.
        print(f'  FAILED {name}: kept the current recording, listed for a retry')
        with open(os.path.join(RAW, 'failed.txt'), 'a') as f:
            f.write(name + '\n')
        return None
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
        try:
            wav = take(name, text, cast, CFG.get('models', {}).get(kind))
        except DailyQuota as q:
            sys.exit(f'Daily quota used up ({q}). Run again tomorrow: finished lines are kept.')
        if wav is None:
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        treat(os.path.join(RAW, name + '.wav'), dest, treatment, rate, bitrate)
        print(name, os.path.getsize(dest) // 1024, 'KB')
