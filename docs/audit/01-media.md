# Audit — Media

**Pages:** `/recorder` Screen Recorder · `/video` Video Studio · `/image` Image Converter · `/exif` EXIF Viewer

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Logic was run in Node against the real libraries: ExifReader 4.36, the self-hosted ffmpeg core with the page's exact commands, and jsPDF. Behaviour that depends on a real browser (tab throttling, MediaRecorder output) is labelled *suspected* or *known platform behaviour*.

---

**The four worst problems:**
- **EXIF Viewer crashes on almost every camera or phone photo.**
- **Screen Recorder records a frozen picture** whenever the user switches away from its tab, which is the normal way to use it.
- **Image Converter breaks after almost any edit.** It discards its own image references whenever the image list changes, so later conversions fail and per-image downloads stop working.
- **The default Video Studio export of a recording downloads an empty MP4** and shows "Export complete!".

---

### /recorder — src/pages/Recorder.jsx (605 lines)

**What it does:**
- Clicking Start asks the browser to share a screen, window or tab (60 fps, with system audio if that toggle is on). It then makes one request for the microphone and/or a 320×240 webcam. If that request fails it shows an `alert` and records the screen only.
- Every recording goes through a hidden canvas, even with the camera off. A `requestAnimationFrame` loop draws the screen plus an optional round webcam bubble in the bottom-left. System and mic audio are mixed through an AudioContext.
- MediaRecorder records the canvas stream plus the mixed audio as WebM/VP8 at 2.5 Mbps, in 1-second chunks kept in React state. There is a muted live preview and a picture-in-picture button.
- Leaving is guarded only while recording, by `beforeunload` and by `useBlocker` with `window.confirm`.
- After stopping you can play the recording, download the WebM, export a GIF with gifshot (800 px wide, 10 fps, at most 200 frames), "Edit in Studio" (sends it to `/video`), or start a new recording.

**Integrations:**
- **Pipeline:** L317-324 sends `{ file: File('recording-<ts>.webm', video/webm), type: 'video' }` and navigates to `/video`. The shape matches what VideoTools expects; the full handoff analysis is under /video.
- **Not used:** smart input (so the CommandPalette `{input}` bug doesn't affect it), toasts (it uses `alert`), AI context.
- **Split pane:**
  - If a pinned Recorder is recording, every navigation in the main pane gets the "recording will be lost" prompt, even though the pinned copy survives.
  - React Router only checks the most recently registered blocker (react-router `chunk-EPOLDU6W.mjs:2946-2950`). With Recorder both pinned and open in the main pane, one of the two can end up unguarded.
  - Unpinning, or resizing the window below 1025 px (Layout.jsx:26,147), removes the pinned Recorder with no prompt. Any in-progress recording is lost.
  - Its `@keyframes pulse` (L594) overrides AIStatusBadge's global `pulse` (AIStatusBadge.jsx:123) while it is on screen.

**Bugs (functional):**
- **R1 — critical — L169-209.** The recording is drawn into a canvas by an animation-frame loop, camera or not. Browsers pause that loop while the tab is hidden or covered.
  - Scenario: pick another tab or app and switch to it. The video freezes on the last frame while the audio keeps recording. Picture-in-picture doesn't help, because it's the same page.
  - Confidence: confirmed by reading, plus standard browser behaviour.
- **R2 — high — L152-154.** The hidden `screenVideo` element isn't muted, and its stream contains the captured tab or system audio, so it plays that audio aloud.
  - Scenario: the user hears a delayed second copy of the audio. Whole-screen capture with system audio may feed back into itself (suspected).
  - If a browser refuses unmuted autoplay, `await play()` throws instead and the start fails as in R3.
  - Confidence: confirmed by reading; the consequences are suspected.
- **R3 — high — L225-229.** Every failure sets status `'error'`, and nothing on the page renders that state (`AlertCircle` is imported but never used).
  - Failures covered: cancelled picker, denied permission, no screen sharing on mobile, or Safari builds that reject `video/webm;codecs=vp8`.
  - Scenario: the "Ready" card disappears and a black box is shown (L557) with no message.
  - If the failure happens after L193, the drawing loop keeps running and the AudioContext from L125 is never closed.
  - Confidence: confirmed by reading.
- **R4 — medium — L356.** The Start button is also shown in the `preparing`, `processing` and `error` states.
  - Double-clicking can start two overlapping setups that share the same refs.
  - Clicking Start during a GIF export clears the chunks. The GIF callback then sets status to `'finished'` (L301/L305) mid-recording, so Stop and the finished buttons show together.
  - Confidence: confirmed by reading.
- **R5 — medium — L565.** `URL.createObjectURL(new Blob(...))` runs inside render, so every re-render in the finished state creates a new URL that is never released.
  - Re-renders come from the final data chunk, from the Mic/Sys/Cam toggles (still visible after stopping, L395), and from pin/unpin (which re-renders everything using the pipeline context).
  - Scenario: playback jumps back to 0 each time, and every recording stays in memory until the page reloads.
  - Confidence: confirmed by reading.
- **R6 — medium — L47-53, L125, L232-243.** Teardown is incomplete.
  - On unmount only the source tracks are stopped; the MediaRecorder itself is not.
  - The canvas and audio-destination tracks are never stopped.
  - Each recording creates a new AudioContext that `stopRecording` never closes.
  - Scenario: unmounting while recording (confirmed leave, unpin, resize) probably leaves a recorder running (suspected).
  - Confidence: confirmed by reading.
- **R7 — medium — L270-280.** Chromium's MediaRecorder WebM files report `duration === Infinity`, so `duration || 5` gives Infinity and 200 frames are always captured.
  - gifshot plays the clip with `loop = true` (gifshot.js:2380) and samples it in real time.
  - Scenario: a 4 s recording becomes a 20 s GIF repeating five times, and anything longer than 20 s is silently cut to its first 20 s.
  - Confidence: confirmed by reading; the Infinity duration is known Chromium behaviour.
- **R8 — low.** For video input, gifshot never removes its capture `<video>` (appended at gifshot.js:2572; the cleanup at 2580 is skipped for video). Each export leaves an invisible looping video in `<body>`. Confirmed by reading.
- **R9 — low, suspected — L294-299.** The GIF is downloaded through a base64 `data:` URL. A typical multi-megabyte GIF probably exceeds Chromium's ~2 MB URL limit, so the download would fail.
- **R10 — medium — L326-336, L509-528.**
  - After stopping, the picture-in-picture button still targets the hidden live-preview element, which has no source (L242, L557). The call rejects (logged only), so the button does nothing.
  - There is no `pictureInPictureEnabled` check (Firefox has no such API).
  - Confidence: confirmed by reading.
- **R11 — low — L105, L184.** The 4:3 webcam frame is drawn into a square, so faces are squashed. The ring is stroked after clipping, so only half its width shows. Confirmed by reading.
- **R12 — low, suspected — L234-239.** The last chunk arrives asynchronously after `stop()`, but status flips to finished immediately. Clicking Download or Edit right away can lose the last ~1 s.
- **R13 — low — L249, L296.** The hidden `<a>` used for each download is never removed from the DOM.
- **R14 — medium (data loss) — L36, L58, L487.** Leaving is only guarded while recording. After Stop the recording lives only in component state, so navigating away, refreshing or "New Recording" discards it silently.

**UX issues:**
- No elapsed-time or size readout, and no "preparing" feedback.
- The toggles have no `aria-pressed`. Their labels mix state and action ("Muted", "No Sys", "Hidden"). They stay visible after stopping although they only affect the next recording.
- No message on mobile or other unsupported browsers.
- Errors use `alert()` (L120, L304, L312) instead of the existing `useToast`.
- The finished-actions row (L448) doesn't wrap, so it overflows in a half-width split pane or on a phone.
- The picture-in-picture button is icon-only with just a `title`.
- During GIF export the stage is an empty black box, and the progress bar sits at 100% for the whole encoding phase.

**Theming issues:**
- L545: "Ready to Record" uses `var(--text-main)`, which is dark in light mode, on the hardcoded `#09090b` stage (L503), so it is nearly invisible. L542 and L546 have low contrast too. Use fixed light text on the stage, or make the stage `var(--bg-panel)`.
- L477: the hardcoded indigo shadow `rgba(99,102,241,.3)` ignores the accent preset. Use `var(--primary-glow)`.
- L507: the heavy `rgba(0,0,0,.5)` shadow looks wrong in light mode. Use `var(--glass-shadow)`.
- L401-434: hardcoded green/blue/purple toggle colours ignore the accent preset, and their 10% tints barely show on light backgrounds.
- No native inputs, so the global input rule doesn't apply here.

**Fix sketch:**
- R1: with the camera off, record the screen track directly. For the overlay, composite in a worker (`MediaStreamTrackProcessor`/`VideoTrackGenerator`), or at least warn that the tab must stay visible.
- R2: `screenVideo.muted = camVideo.muted = true`.
- R3: show an error banner for the `'error'` state. Feature-detect `getDisplayMedia` and `MediaRecorder.isTypeSupported` and pick a supported type. In `catch`, cancel the loop and close the AudioContext.
- R4: show Start only when idle or in error, disable it while preparing, and make the GIF callback ignore a recording that started later.
- R5: build the blob once in `onstop` and create the URL in `useMemo`, releasing it in an effect cleanup.
- R6: in both `stopRecording` and unmount, call `recorder.stop()`, stop every track and `audioCtx.close()`.
- R7: fix the WebM duration (seek-to-1e101 trick or a duration-fixer library) and size the GIF from the real duration, or reuse Video Studio's ffmpeg GIF export.
- R8: in the gifshot callback, `obj.videoElement?.pause(); obj.videoElement?.remove()`.
- R9: convert the data URL to a Blob (`await (await fetch(obj.image)).blob()`) and download that.
- R10: point picture-in-picture at the playback video when finished, and hide the button when unsupported.
- R11: draw the centre square of the camera frame.
- R12: set status to finished inside `recorder.onstop`.
- R13: `a.remove()` after clicking.
- R14: keep the guards while an unsaved recording exists, and confirm before "New Recording".

---

### /video — src/pages/VideoTools.jsx (754 lines)

**What it does:**
- On load it starts single-threaded ffmpeg.wasm 0.12 from the self-hosted `/ffmpeg` ES-module core, via blob URLs.
  - This core doesn't need SharedArrayBuffer, so the missing COOP/COEP headers in production don't matter. It works in both dev and production, but not offline (V16).
- Input: click to upload, or the Recorder handoff. Preview with custom play/seek, a time display and a JPEG frame snapshot.
- Edits:
  - trim (start/end numbers plus "Set" to the current time);
  - crop on a ReactCrop overlay, freeform or 1:1;
  - speed 0.5×–2×;
  - mute, or replace the audio track;
  - 2 s fade in/out;
  - downscale to 1080/720/480 high.
- Export:
  - MP4 with libx264, or a straight stream copy when nothing was edited;
  - WebM (VP8 video, Vorbis audio);
  - GIF (two-pass palette);
  - MP3.
  ffmpeg is shut down and reloaded before every export.

**Integrations (Recorder → Video Studio handoff, end to end):**
- **The handoff itself:** L86-104 picks up `{type:'video', file}`, creates a preview URL, clears the pipeline and resets the editor. This works on the normal path.
- **After it arrives, two things break:**
  - The Chromium recording reports an infinite duration (V5).
  - The default "MP4, no edits" export produces an empty file (V1).
  So the recording arrives, but the default workflow doesn't produce a usable file.
- **Refresh, direct visit, leaving:**
  - Refreshing or opening `/video` directly just shows the empty uploader; no crash.
  - But the recording only ever lived in memory. The Recorder's copy is gone once it unmounts, so leaving `/video` or clicking Clear Project loses it for good, and this page has no `beforeunload` guard.
  - The preview URL is never released (V9), so the recording stays in memory until the page reloads.
- **Split pane:**
  - If VideoTools is pinned, the Recorder's `setPipelineData` is applied before React Router's navigation, which runs inside `startTransition`. The pinned copy grabs and clears the recording, and the main-pane `/video` opens empty. Confidence: confirmed by reading.
  - With two copies on screen there are two 32 MB engines and duplicate `id="file-upload"` / `id="audio-upload"`. The `getElementById` calls (L351, L595) always hit the main pane's input, so uploading from the pinned pane loads into the other copy.
- **Pipeline sharing (suspected):** the pipeline slot is untyped and shared with the text "Send to Pipeline" feature. If navigation to `/video` is interrupted before it mounts, the `{file, type}` object stays there, and text pages' "Read Pipeline" buttons would push it into string state.
- **Other:** `useEscape` is given a new function every render, so the key listener is re-attached on every render, including every playback time update.

**Bugs (functional):**
- **V1 — critical — L295-305, L309-320.** With no edits, MP4 export uses `-c copy`, and "Muted" uses `-an -c:v copy`.
  - Scenario: with a VP8 WebM (every Recorder take, most WebM uploads), ffmpeg exits with code 1 ("Could not find tag for codec vp8 … not supported in container") and leaves a 0-byte `output.mp4`. The page downloads it and says "Export complete!".
  - Confidence: confirmed by running.
- **V2 — high — L309-311.** `ffmpeg.exec`'s exit code is never checked.
  - Any failure that still creates the output file is reported as success with a 0-byte download.
  - Failures that create no file show a raw "ErrnoError: FS error" (e.g. MP3 from a video with no audio).
  - Confidence: confirmed by running.
- **V3 — high — L378-397, L124-130.** Entering or leaving crop mode (L509-513, Esc at L48-53, Clear Crop) swaps between two different `<video>` elements.
  - Scenario: the new element reloads and resets the trim to `[0, duration]`, silently wiping the user's trim. Playback restarts at 0 while the play/pause and time state go stale.
  - Confidence: confirmed by reading.
- **V4 — high — L219-230.** The fade-out start is computed from the source duration.
  - It ignores speed. At 0.5× the fade runs from 2–4 s of an 8 s output and the rest is black. At 2× the fade is scheduled at the very end and never shows.
  - It ignores a trim start when the end isn't trimmed, so the fade never appears.
  - With an infinite duration (Recorder takes) it emits `st=Infinity`. The audio fade then fails to initialise, and the user gets a 0-byte file plus "Export complete!".
  - Confidence: confirmed by running.
- **V5 — high — L124-130, L415-431, L749-754.** A Chromium MediaRecorder WebM reports an infinite duration.
  - The seek slider's `max` becomes invalid and falls back to 0–100 s.
  - The time shows "Infinity:NaN" (verified by running).
  - The End field is blank, and fades break (V4).
  - Confidence: confirmed by reading, plus known Chromium behaviour.
- **V6 — high — L18, L56-83, L172-177.** Leaks and repeated work.
  - Nothing is cleaned up on unmount. Each visit leaves an ffmpeg worker alive, holding its memory and the input/output files, which are never deleted.
  - Every `loadFFmpeg` call (on mount and before each export) creates two never-released blob URLs holding about 32 MB.
  - It also adds another `'log'` listener, and `terminate()` doesn't remove old ones.
  - The engine is re-fetched and recompiled before every export.
  - In dev StrictMode the core loads twice.
  - Confidence: confirmed by reading.
- **V7 — medium — L186, L582-590.** Tick "Muted", then choose a replacement track: the checkbox is disabled but `muteAudio` stays true, so the export silently drops the chosen audio. A replacement track also can't be removed without loading a new video. Confirmed by reading.
- **V8 — medium — L339-372.** The uploader says "Drag & drop", but there is no drop handling. Dropping a video makes the browser open the file and leave the app. Confirmed by reading.
- **V9 — medium — L731-741.** Clear Project only clears `videoFile`.
  - The preview URL isn't released, so the recording stays in memory.
  - Trim, crop, aspect and message state remain.
  - A handed-off recording is discarded with no confirmation.
- **V10 — low — L193-194, L467-488.** Trim isn't validated.
  - Clearing a field gives NaN (React warning, then ignored).
  - Start ≥ end produces a negative `-t`, which ffmpeg accepts and still writes a file (exit code 0) instead of reporting an error. Confirmed by running.
- **V11 — low — L138-144.** `isPlaying` is never synced with the video's own play/pause/ended events. After the clip ends the button shows Pause and needs two clicks. A rejected `play()` is unhandled.
- **V12 — low — L210-212.** The "Max Height" options also upscale smaller videos (`scale=-2:720` on a 480p source).
- **V13 — low — L650 vs L288.** "WebM Video (VP9)" actually encodes VP8 (`libvpx`).
- **V14 — low, suspected — L291.** No `-pix_fmt yuv420p` (4:4:4 sources produce MP4s many players can't play) and no `-preset` (the default is slow in wasm).
- **V15 — low — L148-156.** Taking a snapshot before metadata loads: `toBlob` gives null and `createObjectURL(null)` throws.
- **V16 — low-medium — L73-75, L172-177, vite.config.js:15.**
  - If the reload before export fails, the export carries on with confusing errors, and Export then stays disabled with no Retry.
  - The ffmpeg core is excluded from the PWA cache with no runtime caching, so Video Studio can't start offline.

**UX issues:**
- The upload area (L339) and Replace Audio (L594) are clickable divs over hidden inputs; they can't be reached by keyboard.
- The play/pause button (L403) is icon-only with no label.
- The `.hover-bg` class (L410/L442) isn't defined anywhere.
- Crop: clicking "Active" turns crop off and throws the selection away. A crop is only exported if crop mode stays on, and nothing says so.
- No export progress or cancel. The status is just the last raw ffmpeg log line.
- The button always reads "Export Video", even for GIF or MP3. Settings can still be changed mid-export.
- A replacement track is silently ignored for MP3 and GIF exports.
- Codecs the browser can't play give a blank preview with duration 0 and no message.
- The tab title is "Video Tools" (L12), but the heading and sidebar say "Video Studio".

**Theming issues:**
- `var(--bg-input)` is undefined and resolves to transparent. It is used at L471, 476, 489, 494, 514, 523, 529, 571, 582, 598, 623, 645, 666, 679 and 699. Use `var(--bg-app)`, or define the token.
- L523/L529: the selected aspect button uses `rgba(255,255,255,.1)`, which is invisible in light mode. Use `var(--primary-glow)` with a primary border.
- L725: the message box uses `rgba(0,0,0,.2)`. Use `var(--bg-app)`.
- L355-357 and L598-600: hardcoded `#3b82f6` blue. Use `var(--primary)`.
- Global input rule: the seek slider (L415) gets 16 px padding plus a border and background box, and the "Muted" checkbox (L583) is stretched to full width inside its 35 px label.

**Fix sketch:**
- V1/V2: throw if the exit code is non-zero or the output is empty. Only stream-copy when the input codecs fit MP4, otherwise re-encode (or retry with re-encode on failure).
- V3: keep one `<video>` permanently inside `<ReactCrop disabled={!isCropping}>`, and only initialise the trim when the file changes.
- V4: output duration = `(end − start) / speed` from a real duration, fade start = `max(0, outDur − 2)`; refuse fades when the duration is unknown.
- V5: if the duration isn't finite, seek far ahead and read it on `durationchange`, or probe it with ffprobe. Better, fix the duration in the Recorder.
- V6: create ffmpeg once, cache the core blob URLs, remove listeners with `off`, delete files after export, and terminate plus release URLs on unmount. Drop the reload before each export.
- V7: clear `muteAudio` when a track is chosen, and add a remove (✕) button.
- V8: add drag-over and drop handlers (shared drop zone).
- V9: release the URL, reset all editor state, and confirm when the video came from the Recorder.
- V10: clamp to `[0, duration]`, require start < end, and disable Export otherwise.
- V11: drive play state from the video's `play`/`pause`/`ended` events and catch `play()`.
- V12: `scale=-2:'min(ih,720)'`.
- V13: relabel as VP8, or switch to `libvpx-vp9`.
- V14: add `-pix_fmt yuv420p -preset veryfast`.
- V15: skip the snapshot when `videoWidth` is 0 or the blob is null.
- V16: rethrow from `loadFFmpeg`, show a Retry button, and add a runtime cache rule for `/ffmpeg/*`.

---

### /image — src/pages/ImageConverter.jsx (799 lines)

**What it does:**
- Multiple files by click or drop (`image/*,.heic,.ico`). `.heic` files are converted to JPEG at quality 0.5 by heic2any; other images are used directly. Anything else is silently skipped.
- Per image: rotate 90°, flip horizontally/vertically (shown with CSS, applied on conversion), crop in a full-screen modal (default centred 16:9 at 90%; the result replaces the file as PNG), remove.
- Shared settings: format (PNG/JPEG/WebP/AVIF/BMP/ICO/PDF), quality (disabled for PNG/ICO/BMP), resize W×H with "Maintain Aspect Ratio".
- "Convert All" re-encodes images one by one through a canvas.
  - ICO is a single 256×256 PNG inside an ICO file.
  - PDF is one jsPDF document per image.
  - Each image gets its own Download link, and there is a ZIP of all of them.
- Unreachable: brightness/contrast/saturation/sepia filters, text and image watermark, and "strip EXIF" exist as state and canvas code (L22-28, L200-239, L314-321). There is no UI; the setters have never been called in any commit.

**Integrations:**
- No pipeline, smart input (unaffected by CommandPalette), toasts or AI context. `useEscape` closes the crop modal.
- Pasting an image does nothing: SmartPaste ignores non-text and the page has no paste handler.
- Split pane is fine: it uses refs rather than ids, and the fixed-position crop modal covers both panes.

**Bugs (functional):**
- **I1 — critical — L94-101.** The cleanup effect keyed on `images` releases every preview and converted URL of the previous list on every change, while the new list still uses them.
  - Rotate, flip, crop, remove, or add a second batch: later conversion of those images loads a released URL and fails. The status becomes `'error'`, but the card keeps saying "Ready".
  - Right after Convert All, the Download links (L669) of every image except the last one converted are dead. The ZIP still works because it uses the blobs.
  - Reopening crop shows a broken image (L778).
  - Confidence: confirmed by reading.
- **I2 — high — L276, L288-300, L634, L670-673.** Results aren't tied to the settings that produced them.
  - Change format, quality or size after converting, then Convert All: nothing happens, because finished images are skipped.
  - The ZIP and Download links still use the new extension, so PNG bytes end up named `.jpeg`.
  - Switching the format away from PDF makes cards show the PDF as an image, which breaks.
  - Confidence: confirmed by reading.
- **I3 — high — L586, L593, L600, L405-413.** Rotate, flip and crop reset the status and URL but keep `convertedBlob`, so the ZIP (L297) still includes the pre-edit result. Confirmed by reading.
- **I4 — high — L359-383.** The crop is saved at on-screen size × devicePixelRatio, not at source resolution.
  - Scenario: a 4032 px photo shown about 900 px wide gives roughly 800 px output on a normal display.
  - Confidence: confirmed by reading.
- **I5 — medium-high — L52-60, L186.**
  - The quality-0.5 HEIC "preview" JPEG is also what gets converted and cropped, so every HEIC export has heavy JPEG artefacts, even to PNG.
  - `.heif` / `image/heif` files aren't sent to heic2any. Chrome and Firefox can't decode them, so they fail silently.
  - Confidence: confirmed by reading.
- **I6 — medium — L250.** `toBlob` silently produces PNG when the browser can't encode the requested type: BMP everywhere, AVIF in current browsers, WebP in Safari.
  - The files are still named `.bmp` / `.avif`.
  - Confidence: confirmed by the HTML spec for BMP; likely for AVIF and Safari WebP.
- **I7 — medium — L176, L250.** There is no background fill, so transparent areas turn black in JPEG and PDF output.
- **I8 — medium — L170-174.** jsPDF `unit:'px'` without `hotfixes:['px_scaling']` treats 1 px as 1.333 pt.
  - A 1920×1080 image becomes a 35.6×20 inch page.
  - Images wider than 10,800 px hit jsPDF's 14,400 pt page limit while the image is still drawn full width, so the right side is cut off.
  - Confidence: confirmed by running.
- **I9 — medium — L107-109.** "Maintain Aspect Ratio" is ignored when both W and H are filled in, so the output is stretched.
- **I10 — medium — L272-283.** Convert All works on a snapshot and writes it back after each image. Images added, removed or rotated during conversion are lost or come back. Confirmed by reading.
- **I11 — medium — L42-86, L667-702.** Failures are invisible.
  - No error or "converting" state is shown; any card that isn't done says "Ready".
  - heic2any failures and non-image files are silently dropped.
  - Nothing appears until every HEIC file has been decoded (a single update at L85).
- **I12 — low — L567-573.** The file input is never reset, so choosing the same file again after removing it does nothing.
- **I13 — low — L298-300 vs L670.**
  - The ZIP strips the last extension, but per-image Download cuts at the first dot ("my.photo.png" becomes "my_converted.png").
  - Images with the same base name overwrite each other inside the ZIP.
- **I14 — low — L121-167.** ICO is always a single 256×256 image: it ignores the resize settings, upscales small images, and has no 16/32/48 sizes.
- **I15 — low, suspected — L182.** The `new Promise(async …)` pattern: an exception before the `try` leaves the promise pending forever, and the page sticks on "Processing…". Also, `formatSize` (L423-429) has no GB unit.

**UX issues:**
- No per-card progress or error state, and no feedback when files are skipped.
- The spinner (L523) never spins: `.spin` is only defined inside ApiTester's own inline styles.
- The drop zone (L550) is a click-only div with no keyboard access and no drag-over highlight.
- The card buttons (L585-619) are icon-only with just a `title`; preview images have `alt="preview"`.
- Black preview backgrounds hide transparency and dark images.
- PDF creates one file per image, with no combined multi-page option.
- heic2any (1.35 MB) is imported up front. The `vendor-image` chunk setting (vite.config.js:87) also loads it on the FaviconGenerator and Snippets pages.

**Theming issues:**
- L560/L565: the drop zone's `rgba(255,255,255,.02)` is invisible in light mode, and the L564 hover `rgba(var(--primary-rgb),.05)` ignores the accent preset. Use `var(--bg-card)` / `var(--primary-glow)`.
- L695: the "Ready" pill's `rgba(255,255,255,.05)` is invisible in light mode. Use `var(--bg-app)`.
- L625: the `#000` preview background. Use `var(--bg-app)` or a checkerboard.
- Global input rule: the quality slider (L462) gets padding, border and background, and the aspect checkbox (L496) is stretched to full width.
- The crop modal's hardcoded dark colours are acceptable for a full-screen editor.

**Fix sketch:**
- I1: track which URLs are still in use and release only the ones that disappear; release everything only on unmount.
- I2: store the settings with each result, mark results stale when settings change, and name files from `convertedBlob.type`.
- I3: also clear `convertedBlob` and `finalSize`, and release the old URL.
- I4: size the canvas at `crop.width × scaleX` by `crop.height × scaleY`, without the pixel-ratio transform.
- I5: keep a full-quality HEIC decode as the source, match `/\.hei[cf]$/i` and `image/heif`, and load heic2any only when needed.
- I6: compare `blob.type` with the requested format, then warn and rename, or hide formats the browser can't encode.
- I7: fill white before drawing for JPEG and PDF.
- I8: add the `px_scaling` hotfix (or use pt = px × 0.75), and scale or split very large images.
- I9: when both sizes are set and aspect is locked, fit inside the box.
- I10: update images by id with functional `setImages` updates.
- I11: show error and converting badges, toast skipped files, and add images as they are processed.
- I12: reset `e.target.value = ''` after reading files.
- I13: use one naming helper based on the last dot, and de-duplicate ZIP names.
- I14: write 16/32/48/256 sizes.
- I15: make the promise executor synchronous and wrap the `onload` body in try/catch.

---

### /exif — src/pages/ExifViewer.jsx (269 lines)

**What it does:**
- One image by click (`#exif-input`) or drop, read with `ExifReader.load(file)` (flat tag list).
- Shows a GPS warning with the coordinates and a Google Maps link, or "No GPS location data found".
- Shows 8 highlighted tags and an "ALL TAGS" table (MakerNote and UserComment excluded, values cut at 100 characters).
- "Download Safe Copy" redraws the image on a canvas and saves it in the original format, which removes the metadata. "Analyze Another" starts over.

**Integrations:**
- None: no pipeline, smart input, toasts or AI context.
- Split pane:
  - The pinned pane has no error boundary (Layout.jsx:160). E1 there falls through to React Router's default root error page and replaces the whole app.
  - With the page both pinned and open, the duplicate `id="exif-input"` makes clicks in the pinned pane open the main pane's file input.
- It duplicates PrivacyScanner's EXIF scan (PrivacyScanner.jsx:36).

**Bugs (functional):**
- **E1 — critical — L245.** `value.description?.substring(0,100)` throws "…substring is not a function" whenever a description is a number.
  - ExifReader returns numbers for 'Exif IFD Pointer', 'GPS Info IFD Pointer', ISOSpeedRatings, PixelX/YDimension and GPSLatitude/Longitude, among others.
  - Scenario: practically every camera or phone photo crashes the page into the error screen.
  - Confidence: confirmed by running.
- **E2 — high — L57-65, L199, L203.** The latitude/longitude descriptions are unsigned, and the N/S and E/W reference tags are ignored.
  - Scenario: a southern/western location (S 33.86°, W 151.21°) is shown and linked as "33.86, 151.21". The real location goes nowhere near that link.
  - Confidence: confirmed by running. Currently hidden behind E1.
- **E3 — high (mobile) — L88, L262-266.** The media query writes `flexDirection: column` (JavaScript-style camelCase) in plain CSS, so the browser ignores it.
  - The two columns (300 px minimum each, no wrapping) overflow on phones.
  - Layout's `<main>` has `overflow: hidden` (Layout.jsx:136), so the metadata column is cut off and can't be reached.
  - Confidence: confirmed by reading.
- **E4 — medium — L33-54.** Problems with "Download Safe Copy":
  - There is no error handler, so HEIC and TIFF files, which the page advertises (L122) but Chrome/Firefox can't decode, do nothing.
  - Saving in the original format falls back to PNG for GIF/SVG/BMP/AVIF/TIFF, but the file keeps its original extension (`safe_x.gif` containing PNG).
  - Animated GIFs are flattened to one frame.
  - JPEGs are re-compressed at the default 0.92 quality and the colour profile is dropped, without notice.
- **E5 — medium — L22-31, L253-258.**
  - `isProcessing` is never shown, so there is no loading state.
  - When parsing fails the user gets an `alert()`, and the panel says "Upload an image to inspect its metadata" next to the image that was just loaded.
  - Dropped files aren't type-checked: a PDF gives a broken preview plus the alert.
- **E6 — low — L242-245.** IPTC fields that repeat (arrays), plus the Thumbnail and multi-picture entries, show as "undefined".
- **E7 — low — L18, L161.** Preview URLs are never released.
  - Choosing a second file while the first is still parsing can show the first file's tags.

**UX issues:**
- The main button uses `className="btn-primary"` (L151), which is defined nowhere, so it renders as plain transparent text. `.drop-zone` (L95) is also undefined.
- The drop zone is a click-only div.
- Coordinates show 15 decimal places.
- "View Map" sends the coordinates to Google with no notice, which sits oddly in a privacy tool.
- The iOS photo picker strips location by default, so "No GPS" can give false reassurance.
- Errors use `alert()`. The heading says "EXIF Metadata Viewer" while the nav says "EXIF Viewer".

**Theming issues:**
- L198: the coordinates use `rgba(255,255,255,.7)`, which is invisible in light mode. Use `var(--text-muted)`.
- L197: `#fca5a5` on a light red tint is about 1.7:1 contrast in light mode. Use a darker red.
- L215: `#10b981` on a 10% green tint has low contrast in light mode.
- L177 and L243: `rgba(255,255,255,.02)` for the header and table striping is invisible in light mode. Use `var(--bg-app)`.
- L136: `#000` preview background.

**Fix sketch:**
- E1: convert every cell to a string safely (`String(v?.description ?? v?.value ?? '')`), joining arrays.
- E2: load with `{expanded: true}` and use the signed `tags.gps.Latitude/Longitude`, or negate for S/W.
- E3: `flex-direction: column`, or `flexWrap: 'wrap'`.
- E4: add an error handler and a toast, save to an explicit supported type, and name the file from `blob.type`.
- E5: show a spinner while parsing, show "No metadata found" or the error in the panel, and validate the file type.
- E6: render arrays and objects properly.
- E7: release URLs on replace and unmount, and ignore results from an older request.

---

### Group-level patterns

1. **Four hand-built file inputs, all flawed.**
   - ImageConverter uses a ref; VideoTools and ExifViewer use global ids with `getElementById`, which collide in split pane. PdfTools, HexViewer and PrivacyScanner repeat the pattern.
   - None can be reached by keyboard, VideoTools can't take drops, and none resets the input or supports paste.
   - → One shared `<FileDropZone>` using `useId`, with a keyboard-accessible button, drag state, paste support and input reset.
2. **Object-URL handling is wrong in all four pages.**
   - Created in render without release (Recorder), never released (VideoTools, ExifViewer, ffmpeg core URLs), released too early (ImageConverter).
   - → A `useObjectURL(blob)` hook.
   - → A shared `downloadBlob(blob, name)` helper to replace the 9 copy-pasted download snippets across 7 pages (some never remove the `<a>`).
3. **Duplicated canvas and encoding code.**
   - ImageConverter's conversion and crop, ExifViewer's safe copy and FaviconGenerator's resize each re-implement load → draw → `toBlob`. None checks for a null blob, the silent PNG fallback, or a missing background for JPEG.
   - The ICO writer is copy-pasted (FaviconGenerator.jsx:29-66 vs ImageConverter.jsx:121-167).
   - EXIF parsing is duplicated (ExifViewer vs PrivacyScanner).
   - → Shared `loadImage` / `encodeCanvas` / `writeIco` / `readMetadata` (normalising descriptions to strings and signing GPS).
4. **Media handoff design.**
   - The video handoff rides the untyped text pipeline, held only in memory. It overwrites any text the user had sent, can be grabbed by a pinned copy, and is lost on refresh.
   - Recorder's "Export GIF" (gifshot) duplicates Video Studio's better ffmpeg GIF export.
   - → A dedicated, typed media handoff (optionally saved to IndexedDB/OPFS). Fix the WebM duration at the source.
5. **Feedback is inconsistent.** `alert()` (Recorder ×3, ExifViewer ×1), a raw ffmpeg log line (VideoTools), and silent failure (ImageConverter). `useToast` already exists and none of them use it.
6. **CSS gaps and conflicts.**
   - Undefined classes and tokens: `.btn-primary`, `.hover-bg`, `.drop-zone`, `.spin` (only inside ApiTester's inline style), `--bg-input`.
   - Page-level `<style>` blocks leak globally: Recorder's `pulse` overrides AIStatusBadge's, and ExifViewer's media query is invalid.
   - The global `input` rule hits checkboxes and sliders in VideoTools and ImageConverter. → Exempt `input[type=checkbox|radio|range|color|file]` globally and set `accent-color: var(--primary)`.
   - Hardcoded white-alpha tints and `#000`/`#09090b` stages assume dark mode.
7. **Split-pane hazards.**
   - These pages hold heavy single resources: media streams, MediaRecorder, a 32 MB ffmpeg worker. All of them are destroyed silently when the window crosses 1025 px or the tool is unpinned.
   - The pinned pane has no error boundary.
   - → Wrap the pinned pane in `ErrorBoundary`, and warn before unpinning or resizing removes an active session.
8. **Hooks.** `useEscape` re-attaches its listener on every render, because both callers pass inline functions. Store the callback in a ref.
9. **Accessibility.**
   - Icon-only buttons rely on `title`, or have nothing at all (VideoTools play/pause).
   - Toggles lack `aria-pressed`, clickable divs are used as buttons, and the crop modal has no dialog role or focus handling.
10. **Naming and branding.**
    - "Video Studio" vs "Video Tools", "EXIF Metadata Viewer" vs "EXIF Viewer", and "Private Toolkit" in the header vs "Vibe Toolbelt" in the title.
    - Headers are styled differently on each page (VideoTools uses 40 px padding and 2.5rem).
11. **Bundle and offline.**
    - heic2any (1.35 MB) is imported up front and shared through the `vendor-image` chunk.
    - The 32 MB ffmpeg core is fetched on every Video Studio visit and is never cached for offline use.
