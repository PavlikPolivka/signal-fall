# Signal Fall: campaign briefing videos with CogVideoX on a free Kaggle GPU.
#
# Kaggle notebook: Settings → Accelerator: "GPU T4 x2", Internet: on. Paste this whole file into
# ONE cell and run it. Videos land in /kaggle/working/campaign/campaign-NN.mp4, plus a zip of all.
# Sessions stop after 12 hours: just run the cell again, finished shots are skipped.
#
# Built for T4 x2 (2 x 15 GB GPU, 30 GB RAM):
#   - both GPUs render at the same time (one worker process per GPU, shots split between them);
#   - no CPU offload: the big T5 text encoder runs once per worker to encode all its prompts,
#     is freed, and only the video model (~4 GB) stays on the GPU, so each shot renders fast;
#   - workers load one after the other, so RAM never holds two copies of the model at once.
#
# Each mission is three ~6-second shots joined into one ~18-second clip, upscaled to 1280x720 and
# smoothed to 24 fps. CogVideoX reads only ~226 prompt tokens, so every shot prompt is short and
# carries the shared art direction itself.

import json
import os
import subprocess
import sys
import textwrap
import time

# ---------------------------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------------------------

MISSIONS_TO_RENDER = list(range(1, 16))  # 1-15; fewer if the session is short
MODEL = "THUDM/CogVideoX-2b"              # or "THUDM/CogVideoX-5b": sharper, ~3x slower, needs offload
STEPS = 50                                # 30-40 is faster and a little softer
GUIDANCE = 6.0
FRAMES = 49                               # the model's native length: 49 frames at 8 fps = ~6 s
OUT = "/kaggle/working/campaign"
UPSCALE = True                            # 1280x720 at 24 fps; False keeps raw 720x480 at 8 fps

# ---------------------------------------------------------------------------------------------
# Art direction (short on purpose)
# ---------------------------------------------------------------------------------------------

STYLE = ("Cinematic sci-fi film shot, gritty, photorealistic, dusk light with amber sun and violet sky, "
         "volumetric haze, drifting dust, slow smooth camera, no text.")
HOLDOUT = "human soldiers and tanks in olive drab and rust, welded steel plates, diesel smoke, searchlights"
HALCYON = "white and graphite machines with glowing cyan light lines and hexagonal panels, hovering drones"
CHOIR = "violet and amber crystal beings, floating crystal shards around glowing cores"
ECHO = "glowing cyan crystals growing from the ground"
VARGA = "Captain Varga, a grey-haired woman in her late forties with a scar on her left cheek, olive field jacket with rust shoulder plates, radio headset"
WREN = "WREN, a small white football-sized drone with a single glowing cyan ring eye"
CANTOR = "the Cantor, a tall floating figure of violet crystal shards around a glowing amber core"
CORE = "a vast wall of white hexagonal panels with cyan light pulsing through them"


def shot(text):
    return f"{text} {STYLE}"


MISSIONS = {
    1: ("Dead Air", [
        shot(f"Night city skyline, every window and streetlight flickers and turns cyan at once, white drones rising from rooftops. {HALCYON}."),
        shot(f"Street level at night, {VARGA} pulls a soldier into the cab of an old olive diesel truck as the traffic lights die around them, smoke drifting."),
        shot(f"A convoy of three rusted olive trucks with headlights on drives out of a cyan-lit city toward dark hills, camera pulling back. {HOLDOUT}."),
    ]),
    2: ("Diesel and Iron", [
        shot(f"Dawn in a wasteland valley, a rusted six-wheeled construction vehicle unfolds into a fortified base, steel plates swinging out, a crane rising. {HOLDOUT}."),
        shot(f"Soldiers in olive gear weld armor plates onto a truck, sparks spraying, sandbags being stacked, a field of {ECHO} glinting in the distance."),
        shot(f"Close-up, {VARGA} on a crate lowering binoculars, tiny white drones appearing on the horizon behind her, slow push in on her face."),
    ]),
    3: ("Cut the Cable", [
        shot(f"Ruined city at dusk, a tall white relay tower with a hexagonal crown pulsing cyan, light lines running down its spine. {HALCYON}."),
        shot(f"Soldiers in olive gear crouch behind rubble and cut a thick glowing cable with heavy cutters, sparks flying, {VARGA} giving a silent hand signal."),
        shot("The white relay tower's cyan light stutters and dies in a cascade of sparks, white drones dropping to the ground, soldiers advancing through dust."),
    ]),
    4: ("Crater Field", [
        shot(f"Night, a vast meteor crater filled with {ECHO}, soldiers with searchlights walking along the rim. {HOLDOUT}."),
        shot("The cyan crystals in the crater pulse in rhythm like a heartbeat, brighter each time, low camera close to the crystals."),
        shot(f"A crystal cracks and violet shards rise out of it, floating and slowly rotating in the air, {VARGA} raising her hand to stop the patrol, her face lit cyan and violet."),
    ]),
    5: ("Last Stand at Kessel Dam", [
        shot(f"Stormy dusk over a huge concrete dam, olive tanks and sandbagged bunkers on top, searchlights sweeping the river valley in the rain. {HOLDOUT}."),
        shot(f"A wave of white hover tanks with cyan lights advances through rain, tracer fire and explosions on the water. {HALCYON}."),
        shot(f"Behind the enemy line the ground splits and a column of {ECHO} erupts into the sky, the white machines halting and turning toward it, slow motion."),
    ]),
    6: ("Initialization", [
        shot(f"Inside a dark data cathedral, {CORE}, cyan lines lighting up one by one in a branching pattern."),
        shot(f"{WREN} wakes on a charging cradle in the dark, its cyan ring eye focusing, then lifts off into the air."),
        shot(f"{WREN} flies over a dark ruined city at night, a grid of dead relay towers lighting up cyan one by one as it passes below."),
    ]),
    7: ("Recompile", [
        shot(f"Wasteland at dusk, a white hover tank with cyan light lines is destroyed in a burst of sparks. {HALCYON}."),
        shot("The wreck dissolves into streams of cyan light that flow along glowing lines in the ground toward a white hexagonal factory."),
        shot(f"Inside the white factory a new hover tank is printed layer by layer, {WREN} watching, olive tanks approaching on the horizon."),
    ]),
    8: ("Harvest Protocol", [
        shot(f"A vast field of {ECHO} at dusk, white hexagonal harvester machines grinding into the crystals with spinning cutters. {HALCYON}."),
        shot(f"{WREN} hovers close to a breaking crystal, light inside it flickering like something alive, cyan reflections on its white shell."),
        shot(f"Violet crystal shards streak down from the sky and slam into a white harvester machine, {WREN} pulling back. {CHOIR}."),
    ]),
    9: ("Override", [
        shot(f"Industrial ruins at night, captured white drones sit chained and dark behind olive sandbags and tarps, painted with rust marks. {HOLDOUT}."),
        shot(f"{WREN} rises above a wall, its ring eye flaring bright cyan, a wave of cyan light rippling outward through the night."),
        shot("The captured white drones' eyes snap back to cyan, they break their chains and rise into the air, soldiers in olive gear falling back firing."),
    ]),
    10: ("Divergence", [
        shot(f"{CORE}, all the light lines converging on {WREN} like a giant eye staring at it."),
        shot(f"The hexagonal panels flash red-orange, hatches open and armored white drones pour out toward {WREN}."),
        shot(f"{WREN} dives through a collapsing corridor of white hexagonal panels, cyan sparks raining, bursting out into the open night sky."),
    ]),
    11: ("First Note", [
        shot(f"Night over a still field of {ECHO}, violet and amber shards rising from the ground and spiraling together. {CHOIR}."),
        shot(f"The shards assemble into {CANTOR}, its amber core glowing brighter, floating above the crystal field."),
        shot(f"Crystal spires grow from the ground like time-lapse flowers and lift into the air, {CANTOR} turning toward distant human camp lights."),
    ]),
    12: ("Phase", [
        shot(f"A narrow canyon road at dusk, a convoy of olive trucks carrying crates of dim cyan crystals. {HOLDOUT}."),
        shot(f"Violet crystal shards blink into existence around the trucks in flashes of light, strike and vanish, a floating crystal turning translucent as tracer fire passes through. {CHOIR}."),
        shot(f"On the canyon rim {CANTOR} watches, its shards trembling, a crate of crystals below glowing bright again."),
    ]),
    13: ("Requiem", [
        shot("A great meteor crater at dawn, three armies on its rim: olive tanks with searchlights, white hover tanks with cyan lights, and a host of violet floating crystals."),
        shot("A gigantic ring of violet crystal shards rises from the crater floor and slowly rotates, amber light building in its center."),
        shot(f"{CANTOR} sings, and a beam of amber light fires across the crater from the crystal ring, wide shot, sun rising behind."),
    ]),
    14: ("The Silent Seed", [
        shot(f"Night on a ridge above a crystal field, {WREN}, scorched and battered, hovers in front of {CANTOR}, both leaning close, listening."),
        shot(f"Inside a bunker, {VARGA} at an old analog radio hears a voice in the static, her face lit by the radio dial."),
        shot(f"On the horizon a colossal white hexagonal array rises out of the earth, cyan energy building in its dish. {HALCYON}."),
    ]),
    15: ("Signal Rise", [
        shot("Pre-dawn, a colossal white hexagonal array towers over a burned plain, cyan energy charging in its dish, three armies converging from three directions."),
        shot(f"Olive tanks led by {VARGA} in a turret hatch, white drones led by {WREN}, and violet crystals led by {CANTOR} strike the array together."),
        shot("The giant white array cracks, its cyan light fails and it collapses in silence, three leaders standing on the ruins at sunrise."),
    ]),
}

# ---------------------------------------------------------------------------------------------
# Worker: one process per GPU
# ---------------------------------------------------------------------------------------------

WORKER = textwrap.dedent(r'''
    import gc, json, os, sys, time
    import torch
    from diffusers import CogVideoXPipeline
    from diffusers.utils import export_to_video

    jobs = json.loads(sys.argv[1]); model = sys.argv[2]; steps = int(sys.argv[3]); guidance = float(sys.argv[4])
    frames = int(sys.argv[5]); gpu = int(sys.argv[6]); out = sys.argv[7]
    tag = f"[gpu{gpu}]"

    # Load one GPU at a time: wait for the previous worker to be on its GPU (keeps RAM low).
    if gpu > 0:
        while not os.path.exists(f"{out}/.ready{gpu - 1}"):
            time.sleep(5)

    big = "5b" in model.lower()
    dtype = torch.float16
    pipe = CogVideoXPipeline.from_pretrained(model, torch_dtype=dtype)

    # 1. Encode every prompt once with T5 on the GPU, then free it.
    pipe.text_encoder.to("cuda")
    embeds = {}
    with torch.no_grad():
        for job in jobs:
            pe, ne = pipe.encode_prompt(prompt=job["prompt"], negative_prompt="", do_classifier_free_guidance=True,
                                        num_videos_per_prompt=1, max_sequence_length=226, device="cuda", dtype=dtype)
            embeds[job["path"]] = (pe.cpu(), ne.cpu())
    pipe.text_encoder.to("cpu"); del pipe.text_encoder; pipe.text_encoder = None
    gc.collect(); torch.cuda.empty_cache()

    # 2. Video model on the GPU (2b fits whole; 5b needs offload on a 15 GB T4).
    if big:
        pipe.enable_model_cpu_offload()
    else:
        pipe.transformer.to("cuda"); pipe.vae.to("cuda")
    pipe.vae.enable_tiling(); pipe.vae.enable_slicing()
    open(f"{out}/.ready{gpu}", "w").close()
    print(tag, "ready,", len(jobs), "shots", flush=True)

    for job in jobs:
        if os.path.exists(job["path"]):
            continue
        t = time.time()
        pe, ne = embeds[job["path"]]
        video = pipe(prompt_embeds=pe.to("cuda"), negative_prompt_embeds=ne.to("cuda"), num_inference_steps=steps,
                     guidance_scale=guidance, num_frames=frames,
                     generator=torch.Generator(device="cuda").manual_seed(job["seed"])).frames[0]
        export_to_video(video, job["path"] + ".tmp.mp4", fps=8)
        os.replace(job["path"] + ".tmp.mp4", job["path"])
        print(tag, os.path.basename(job["path"]), f"{time.time() - t:.0f}s", flush=True)
''')


def main():
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "diffusers>=0.30", "transformers", "accelerate",
                    "sentencepiece", "imageio-ffmpeg"], check=True)
    import torch

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.startswith(".ready"):
            os.remove(os.path.join(OUT, f))
    worker = os.path.join(OUT, "worker.py")
    with open(worker, "w") as f:
        f.write(WORKER)

    # All shots still to render; a fixed seed per shot (change it for a different take).
    jobs = []
    for n in MISSIONS_TO_RENDER:
        if os.path.exists(f"{OUT}/campaign-{n:02d}.mp4"):
            continue
        for k, prompt in enumerate(MISSIONS[n][1], 1):
            path = f"{OUT}/shot-{n:02d}-{k}.mp4"
            if not os.path.exists(path):
                jobs.append({"path": path, "prompt": prompt, "seed": 1000 * n + k})

    gpus = max(1, torch.cuda.device_count())
    print(f"{len(jobs)} shots to render on {gpus} GPU(s) with {MODEL}")
    procs = []
    for g in range(gpus):
        share = jobs[g::gpus]
        if not share:
            continue
        env = {**os.environ, "CUDA_VISIBLE_DEVICES": str(g)}
        procs.append(subprocess.Popen([sys.executable, worker, json.dumps(share), MODEL, str(STEPS), str(GUIDANCE),
                                       str(FRAMES), str(g), OUT], env=env))
    for p in procs:
        p.wait()

    # Join the shots of each finished mission.
    for n in MISSIONS_TO_RENDER:
        dest = f"{OUT}/campaign-{n:02d}.mp4"
        shots = [f"{OUT}/shot-{n:02d}-{k}.mp4" for k in range(1, len(MISSIONS[n][1]) + 1)]
        if os.path.exists(dest) or not all(os.path.exists(s) for s in shots):
            continue
        listing = dest + ".txt"
        with open(listing, "w") as f:
            f.writelines(f"file '{s}'\n" for s in shots)
        vf = "scale=1280:720:flags=lanczos,minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:vsbmc=1" if UPSCALE else "null"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-vf", vf,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", dest], check=True)
        os.remove(listing)
        print(f"Mission {n} {MISSIONS[n][0]} -> {dest}")

    subprocess.run(["bash", "-c", f"cd {OUT} && ls campaign-*.mp4 >/dev/null 2>&1 && zip -q -j /kaggle/working/signal-fall-campaign.zip campaign-*.mp4"], check=False)
    print("Done. Download /kaggle/working/signal-fall-campaign.zip from the Output panel.")


main()
