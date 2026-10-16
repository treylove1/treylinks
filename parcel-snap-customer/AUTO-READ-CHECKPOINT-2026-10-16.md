# Parcel Snap auto-read checkpoint — 2026-10-16

Branch: `parcel-snap-auto-read-20261016`
Commit: `c426e32c14351265440787bcbed93dd2c2a2c54e`
Backup branches:
- `backup/parcel-snap-before-auto-read-20261016` -> pre-change main checkpoint
- `backup/parcel-snap-auto-read-c426e32` -> post-change auto-read checkpoint

Change scope:
- Selecting a camera or gallery photo now schedules the existing local OCR reader automatically as soon as the prepared photo is ready.
- The manual Read button remains only as a retry fallback.
- The visible Check backend readiness control is hidden; backend compatibility is already checked automatically during `loadWorkspace()`.
- No production save/email gate was enabled and `writesEnabled` remains false.

Next acceptance:
1. Test on Android with camera photo and gallery photo.
2. Confirm OCR starts without pressing Read.
3. Record photo-selection-to-field-ready timing.
4. If satisfactory, separately review enabling the controlled arrival/save/email path.
