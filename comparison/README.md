# Local lip-sync comparison

Side-by-side playback of this LivLiv Player fork and [MarioAtoms/TalkingHead](https://github.com/MarioAtoms/TalkingHead) commit `1563de184c19b310de4b636664d5835e2c74dbba`. The package is a static page plus a loopback file server. Voice stays in the browser. There is no account, API key, upload, or paid service.

The MSI recording `C:\Users\Mario\slgirl-work\slgirl-morning-2026-10-26\11.wav` (about 4.04 s, 194 KB) is **not** in this package. Pick it with the file control after the page is open. A visual check of that clip is still to be done on the MSI machine. The bundled sounds are only for setup and for the cloud test.

## Windows start and stop

Unzip the package into its own folder, for example `C:\lipsync-compare`. Do not put it in the VoiceStudio tree.

Node.js 24.22.1 is enough. Do not run `npm install`. Python and ffprobe are not used.

```bat
cd /d C:\lipsync-compare
START-WINDOWS.cmd
```

Leave that window open. In Edge, open **`http://127.0.0.1:8877/`**. Use `127.0.0.1`, not a LAN address. The process binds `127.0.0.1` and, when the OS allows, `::1`.

Stop it from a second window:

```bat
cd /d C:\lipsync-compare
STOP-WINDOWS.cmd
```

Or press Ctrl+C in the server window.

If 8877 is taken, pick another free port. **3900 and 8790 are refused** so VoiceStudio and the other local Python process stay untouched.

```bat
set PORT=8878
START-WINDOWS.cmd
```

Then open `http://127.0.0.1:8878/`.

## What to do with a clip

1. Choose the WAV. The same bytes are shown once (name, size, SHA-256, decoded duration and rate) and passed to whichever engine you play.
2. Press **Play LivLiv**, **Play TalkingHead**, or **Play LivLiv, then TalkingHead**. Only one engine is audible. The other is stopped first.
3. **Reset** stops both and clears the visemes. The file stays loaded.
4. TalkingHead timings default to **None**. In that mode the audio plays and the viseme weights stay at rest. That is the engine's real behavior, not a broken player and not an amplitude mouth.

Optional timings, still local:

- **Bundled hello word window** — only after loading the bundled public-domain hello. One known word, placed on the loud part of that file by an energy gate. Not phoneme alignment.
- **Sidecar JSON** — your own timings for a file you picked, including the MSI clip if you have them from somewhere else. This page will not create them.
- **Synthetic unaligned fixture** — the word `hello` from 300 ms for 1500 ms. It only proves the viseme path runs. It is not a transcription of the audio.

Sidecar shape, times in milliseconds:

```json
{
  "words": ["hello"],
  "wtimes": [120],
  "wdurations": [480]
}
```

Optional, and only together with `words`: `visemes`, `vtimes`, `vdurations`. Viseme ids are the Oculus set `aa E I O U PP SS TH DD FF kk nn RR CH sil`. A file that has visemes and no words is rejected. At this TalkingHead commit, `speakAudio` applies visemes only inside the `words` branch, so those visemes would otherwise be ignored.

## What each engine actually does

**LivLiv Player** (`createSpeech`, talk-motion off): the mouth is the speech-band loudness envelope (about 150–1500 Hz, normalized per clip, with a short lead) plus a spectral vowel cue, about −1 round through +1 wide. The Aoi model turns that into closed / half / open / round / wide frames. No text and no phonemes. A WAV is enough. This is the real LivLiv path, not a fallback standing in for visemes.

Idle blink and sway stay on. Head nods from the voice are off (`motion: 0`) so the mouth is what you compare.

**TalkingHead** (`speakAudio`, `isRaw: true`, English module): visemes are either

- `lipsync-en` letter-to-sound rules (NRL-style) scaled across each supplied word's `wtimes` / `wdurations`, or
- `visemes` / `vtimes` / `vdurations` when those arrays are supplied along with `words`.

There is no audio-to-viseme model in this project. [HeadAudio](https://github.com/met4citizen/HeadAudio) is a different project and is not included. `speakText` needs a Google TTS endpoint and is not used. Draco is off, so the gstatic decoder URL in the upstream source is not requested.

`isRaw` skips TalkingHead's speaking hand gestures, camera look, and the extra 300 ms break. The viseme math is unchanged. The upper-body camera is selected so the mouth stays in frame. In any view other than full, TalkingHead also randomizes some expression baselines (mouth dimples, brows, and similar). Those twitches are **not** visemes. Use the viseme readout.

## Limits

- Localhost only. No deployment, no account, no microphone, no camera.
- No phoneme timings are derived from audio. Without a sidecar, the MSI clip can drive LivLiv and can only be heard on TalkingHead.
- English rules only. Other TalkingHead language modules are not in the package.
- One audible engine at a time. The panels stay on screen; the quiet one is at rest.
- Sample avatars are non-commercial. Aoi: LivLiv Featured Characters License, credit "Characters: LivLiv (livliv.ai)". brunette.glb: Ready Player Me, CC BY-NC 4.0, file unchanged. See `public/licenses/`.
- The public-domain hello is a single British-English word from Wikimedia Commons, converted to 24 kHz mono PCM. It is not the MSI clip.
- Synthetic tones are generated in the package. They are not speech.
- This package does not rank the engines. A cloud test can show that mouths and visemes move. It cannot say which looks more in sync, and the MSI clip has not been played here.

## Files

`DEPENDENCIES.md` lists versions and licenses. `SHA256SUMS.txt` lists every file in the unzipped package. `SOURCE.json` repeats the pinned commits. `public/source.json` is the same document.
