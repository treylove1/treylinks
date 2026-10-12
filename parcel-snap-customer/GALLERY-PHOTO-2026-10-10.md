# Camera and gallery photo selection

Package intake and warehouse arrival each offer two clearly labelled options:

- **Take photo:** requests the outward-facing camera on supporting mobile browsers.
- **Choose from gallery:** opens the device's image chooser without requesting camera capture.

Each option accepts one image. The selected image follows the existing processing and human-review path. Selection does not receive a package or send an arrival notice. The photo shown for final review is the same encoded image used by the existing save request. No gallery enumeration, extra account connection, new upload destination, batch intake, or automatic email action is added.

The gallery route resolves the current camera handler when a file is selected, including the later vision-enhanced handler. Camera and gallery therefore share cancellation, stale-result protection, review resets, and save-in-flight guards. Reopening a picker allows the same file to be selected again. Cancelling preserves the reviewed photo and fields. A failed image decode clears stale preview evidence and suggests a supported replacement photo.

## Phone picker search

Browse existing photos and use the native picker's search if it provides one. The chooser's layout, available providers, and search depend on the phone and browser. This change does not implement a separate whole-gallery search engine or grant access to every photo.

- [MDN: file input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file): file selection is browser/OS controlled; the `capture` attribute requests a capture device and `accept` filters the chooser's file types.
- [Android: photo picker](https://developer.android.com/training/data-storage/shared/photo-picker): the platform picker offers browsable media and grants access to selected items rather than the entire library. Native Android documentation is context, not proof that a particular browser uses that picker or exposes search.

## Validation and rollout

Local, network-guarded tests cover both intake handlers, arrival, input attributes, same-file reselection, picker cancellation, camera/gallery races, stale model results, unreadable-image retries, save locks, manual review, and displayed/submitted image identity. All images and responses in these tests are synthetic. Tests do not invoke hosted inference, send email, upload real photos, or exercise a physical phone.

Before release acceptance on a real device, check both controls, picker search/browsing availability, selection of an existing label, cancellation, selecting the same label again, camera capture, and the reviewed preview. Verify the intended customer and photo before any separately authorized end-to-end send. Existing hosted-test budget and approval limits still apply.

This candidate does not replace or modify any frozen acceptance build. Publication and deployment remain separate steps.
