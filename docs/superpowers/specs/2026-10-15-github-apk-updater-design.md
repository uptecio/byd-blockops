# Block Ops GitHub APK updater design

Status: proposed design for user review. No updater implementation is included in this document.

## Outcome

Players can update the installed Android game without finding an APK in a browser. Home checks the public `uptecio/byd-blockops` GitHub repository, announces a newer stable release, and offers an update flow with download progress and Android installation confirmation. Updates retain existing XP, cosmetics, settings, records and PIN by replacing the installed app without uninstalling it.

The user approved automatic Home checks, downloads only after choosing Update, and using GitHub Releases as the download source. This design also proposes a manual Check for Updates control, a Later option, foreground-only downloads and Android-only updater controls. These defaults are part of the review, not additional previously confirmed requirements.

Existing copies need one manual installation of the updater-enabled APK. Future APKs must retain the package identity and signing key. The vehicle must permit third-party installation; the app will not bypass BYD or Android restrictions.

## Approach

Use Android code for release discovery, download, validation and installation. A small web UI adapter displays availability on Home and opens a native update dialog. Native buttons in that dialog initiate downloads and installation. A narrow bridge does not expose installation, arbitrary network requests or file access to JavaScript.

Alternatives considered:

- Opening the GitHub release in an external browser is simpler, but leaves players to locate and install the file themselves and does not provide the requested in-game download.
- Downloading through the game WebView would require loosening its existing network restrictions and adding file handoff. Native networking keeps those restrictions intact and supports older WebViews without relying on browser download APIs.

No game mechanics, multiplayer protocol or server deployment changes are needed.

## Player experience

1. On Home, silently check for a newer stable release. Never block Home or offline play while checking.
2. Show a compact Update available notice with the installed and available versions. No automatic modal, download or system notification. Hide update notices during matches, lobbies and other game screens.
3. The Home Update button opens a native dialog with the version, download size, a short plain-text description, Download Update and Later. This native confirmation is the download consent boundary.
4. Download Update starts a foreground download with percentage, transferred bytes and Cancel. No APK is downloaded just by opening Home or checking availability.
5. Once validation succeeds, show Install Update. Explain that Android may close the game during installation and the player may need to reopen it.
6. If Android has not allowed this game to install packages, explain the permission and offer Open Settings. On return, recheck permission and require the player to press Install Update again. Do not launch installation automatically on resume.
7. Open Android's installation confirmation. Cancellation or failure returns to a usable Home with a clear message and retry option. Success replaces the app; do not promise automatic relaunch.

Home also has Check for Updates. It shows checking, up to date, update available, or a short actionable error. Later dismisses the prominent notice for that release for the current app session; the manual control remains available. A newer release can show a new notice.

The browser build has no APK updater controls and makes no GitHub update requests. The Android adapter is optional, so its absence cannot prevent normal startup.

## Checks and release selection

The native client owns the fixed endpoint `https://api.github.com/repos/uptecio/byd-blockops/releases/latest`. The app contains no GitHub access token and accepts no configurable repository or update URL.

Check at the first foreground Home visit when the last successful check is at least six hours old. Persist successful check metadata in a separate updater preferences namespace. Reuse the result within that window. After automatic failures, wait at least fifteen minutes before another automatic attempt. Manual checks bypass the six-hour cache but are limited to one request every thirty seconds. Both automatic and manual checks honor a longer server retry deadline. Concurrent requests are coalesced.

Only published, non-draft, non-prerelease releases with tags of the form `vMAJOR.MINOR.PATCH` qualify. Compare numeric components, not lexical strings. An unsupported local version or malformed remote version produces a manual-check error and never an automatic update offer. Equal and older releases do not prompt.

Select exactly one APK asset whose filename begins with `block-ops-` and ends with `.apk`. Reject ambiguous releases, missing assets, zero or oversized files, and non-HTTPS or foreign-repository download URLs. The current v0.10.0 release already follows this convention. A tag is only an availability hint: the downloaded APK must independently pass the actual Android version checks below.

Prefer the asset's valid `sha256:` API digest. A present but malformed digest is an error. If absent, fetch the release's single `SHA256SUMS` asset and require exactly one valid SHA-256 entry for the selected APK filename. Duplicate entries, disagreement between digests when both are available, or missing integrity data block installation. Checksums detect corruption; the APK signature establishes application identity.

Native networking uses ordinary platform TLS verification, no permissive certificate handlers, a descriptive User-Agent, bounded timeouts and response limits. Metadata and checksum responses are limited to 512 KiB each; APKs are limited to 100 MiB. Use a ten-second connect timeout, thirty-second read timeout and five-minute total transfer deadline. Permit at most five redirects. Each hop must remain HTTPS with no user information or nonstandard port; permit only exact GitHub hosts needed by the release service: `api.github.com`, `github.com`, `release-assets.githubusercontent.com` and `objects.githubusercontent.com`. Initial asset URLs must match this repository's release-download path. Do not forward authentication or log signed CDN query strings. New CDN hosts require a reviewed app change, not a wildcard trust expansion.

## Download and APK verification

Use a single native worker and app-private updater files. Never download to shared storage or request broad storage permission. Write to an owned temporary file, compute the checksum while streaming, and verify the received byte count against release metadata before promoting it to a complete candidate. Check free space before download and handle disk-full failures during writes.

Cancel closes the active connection and removes only this transfer's partial file. Generation identifiers reject stale progress or completion callbacks after cancellation, retry or a changed release. There is at most one active transfer and one complete candidate. Recheck the selected release before starting a fresh download so a dismissed or replaced candidate cannot silently install.

Before offering Install, and again immediately before creating an installer session, verify all of:

- Complete byte count and SHA-256 digest match the selected asset.
- Package name is exactly `au.local.blockops`.
- APK version name agrees with the selected release tag and its numeric Android version code exceeds the installed app's code.
- APK signing certificate matches the installed app's current signer, using the appropriate package APIs on Android 8 and newer. This release does not support signing-key rotation.
- The APK's minimum supported Android version does not exceed the current device version.

Reject malformed APKs and missing or ambiguous signer information. Keep the existing certificate pinned in packaging acceptance tests as well. Android's package installer remains the authoritative final signature and package verifier.

The candidate is rehashed after any process recreation. Stored metadata and a leftover file are not evidence of a completed trusted download. Do not expose private paths to JavaScript or other apps.

## Android installation and lifecycle

Add only `android.permission.REQUEST_INSTALL_PACKAGES` to the existing INTERNET permission. Use `PackageInstaller` sessions, avoiding a shared-file provider or storage permission. Explicitly require user action on Android versions with that setting, and handle pending-user-action on every supported version. The supported flow does not depend on silent self-update exceptions. [Android installer confirmation rules](https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)).

Check `canRequestPackageInstalls()` before installation. Open only this app's install-source settings when requested. Permission denial, unavailable settings or a missing/blocked installer must produce a useful message without bypass attempts. [Android install-source permission](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()).

Installer status delivery uses a narrowly addressed callback with API-appropriate PendingIntent flags and an app-owned session identifier. Validate the expected session before accepting callbacks. Handle pending confirmation, success, cancellation, insufficient storage, incompatible package and other failure statuses. Only launch installer UI while the app is foregrounded and the player has explicitly chosen installation. Do not launch activities from a background callback.

Opening the native dialog clears held controls and uses the existing pause behavior. Downloads continue across Activity recreation while the application remains foregrounded, but not as a background service. Backgrounding the application or leaving Home cancels an incomplete download and explains that Retry starts it again. Already complete candidates remain available after returning from Android settings or an installer cancellation, subject to revalidation.

Persist the candidate identity and owned installer session ID atomically. On a new process, discard orphan partial files and reconcile recorded sessions against the installed version and PackageInstaller's session state. Do not blindly replay a commit or launch installer UI. A completed replacement clears obsolete updater state. An uncommitted session can be abandoned; an uncertain submitted session must be queried before permitting a second attempt. If confirmation cannot be recovered safely, present a retry path after resolving the old session. Never touch sessions created by other apps.

Keep the current WebView origin, storage profile and game-save keys unchanged. Do not clear localStorage, app data or the PIN, and never uninstall as an update workaround. Future packages must use the original signing key; creating a new debug key is not an acceptable fallback. [Android signing compatibility](https://developer.android.com/studio/publish/app-signing#considerations).

## Module boundaries and web security

Keep MainActivity as an integration point rather than placing all updater logic there. Separate release selection and URL/version rules, bounded HTTP/download transport, candidate storage and verification, installer/lifecycle coordination, and native dialog presentation. Inject transport and installer dependencies for tests; production construction fixes them to the real repository and Android services.

The JavaScript adapter has only three responsibilities: report whether Home is visible, request a metadata check, and open the native update dialog. A small `@JavascriptInterface` object exposes only those commands with primitive arguments. It does not accept URLs, filenames, intent values, arbitrary JSON commands or script strings. Download, cancel and install actions belong to native dialog listeners.

Bridge calls marshal onto the main thread. Native code verifies that the active WebView is still the packaged local document and the Activity is foregrounded before showing a dialog. Home visibility is a UI hint, not a security boundary. Invalid argument types and unexpected calls fail closed. Remove the bridge and detach callbacks on renderer failure or WebView destruction.

Preserve local-only navigation, asset allowlisting, disabled file/content access, blocked popups, no frames and the current CSP. Do not load GitHub pages or release HTML into the WebView. Native status messages contain only bounded plain-text fields and finite numeric values; JSON-encode them before invoking a fixed JavaScript callback, and render with textContent. Never expose downloaded APK paths or unchecked release content. These restrictions address the all-frames exposure of JavaScript interfaces. [Android WebView bridge guidance](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

Updater failures are isolated from the game startup error boundary. Missing bridge, late callbacks, offline networking and malformed metadata must not blank the arena or break Home, settings or existing pause behavior.

## Verification and release

Proposed first version: **0.11.0**, Android version code **15**, multiplayer protocol **8** unchanged. Keep v0.10.0 and its release assets intact. Future releases must monotonically increase version codes, publish one correctly named APK, retain the signer and include matching integrity information. Upload and verify assets in a draft before publishing a release so clients do not see incomplete downloads.

Verification must cover:

1. Pure policy tests for numeric versions, release/asset selection, digest parsing, redirects, size limits, retry/cache rules and stale callback rejection.
2. Android tests for package/version/signer validation, file cleanup, permissions, session status handling and process/Activity recreation. Wrong-package, wrong-signer, old-version, corrupt and truncated APKs cannot reach installation.
3. Playwright checks of Home availability UI, optional native adapter, Later/manual checks and no interference with gameplay. Normal browser builds make no updater requests. Exercise representative desktop, touch and older-browser layouts.
4. Real Android installer testing on an API 26-era emulator and a modern emulator: manual v0.10.0-to-updater upgrade, then an updater-driven installation of a genuinely newer signed fixture APK. Retain real earned XP, selected cosmetics, settings, records and an established PIN across both replacements. Assert temporary Solo Powers remain reset.
5. Real permission denial/grant, cancellation, offline/timeout/rate-limit, disk/download failures, background interruption and return-to-Home behavior. Reopening after settings must not unexpectedly resume combat.
6. Fresh full game tests, browser regressions proportionate to Home changes, Android package/signature checks and lint. Preserve the existing Internet server and all live rooms throughout verification.

Use isolated test builds and release metadata fixtures for the second upgrade; do not publish fake releases or add production endpoint overrides. Clearly distinguish mocked metadata checks from a real signed installer replacement. The final APK must contain the fixed production endpoint and no test update source. A real GitHub discovery/download check can use the existing public release without attempting a downgrade.

Deliver the updater APK, verified checksums and test evidence locally. Public release publication and live-browser deployment remain separate actions; neither is needed to review this design or run fixture-based installer tests. One physical BYD check is still required to confirm its permission settings, installer, network access and touch flow. Emulator success must not be described as verified vehicle compatibility.

## Not included

No silent installation, background download service, push notifications, forced updates, accounts, telemetry, updater support in ordinary browsers, store integration, alternate repositories, signing-key rotation, game-save redesign or vehicle restriction bypass.
