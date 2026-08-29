---
name: apple-release
description: "Qualify and deliver Apple applications end to end: Xcode archives, signing and entitlements, App Store Connect uploads, TestFlight internal and external testing, App Review submission, Mac App Store distribution, Developer ID signing, notarization, stapling, Gatekeeper checks, and Apple account/support diagnosis. Use when the user explicitly authorizes an Apple-side release action or asks for release readiness."
---

# Apple release and distribution

This workflow is intentionally gate-based. Obtain one clear authorization for
the exact app, platform, version/build, and distribution channel, then carry it
through every in-scope release step without repeatedly asking for confirmation.
Do not ask the user for credentials that are already configured on the desktop.

## 1. Preflight

Read the owning repo's `AGENTS.md`, release script, project status, generator
source, and current branch/CI state. Confirm with read-only inspection:

- active Xcode and SDKs;
- bundle IDs, schemes, configurations, version, and build number;
- target graph, extensions, embedded apps, capabilities, entitlements, and
  provisioning expectations;
- clean/isolated build and artifact directories;
- Apple account/team access and the exact credential mechanism, without printing
  credential contents;
- current Apple upload requirements and statuses in the official docs linked
  below.

### Personal desktop defaults

Use the personal Apple Developer/App Store Connect account already configured on
the user's Mac. Resolve identity from non-secret metadata only: active Xcode
team, certificate names, App Store Connect app/team metadata, and configured
Keychain profiles. Do not ask which account to use, switch to another team, or
request a password/private key when the personal desktop setup is available.

Credential resolution order:

1. Existing Keychain-backed profile or repository-documented secure reference.
2. A local API-key file already configured by the user on the desktop, accessed
   without printing or copying its contents.
3. A hidden interactive credential setup only when no configured mechanism works.

Never put a private key, app-specific password, JWT, or normal Apple password in
an argument, log, repository file, screenshot, or chat. Preflight all of this
before the first mutation so a release does not stop halfway for a predictable
credential or account question.

Do not reuse a build number. Do not assume the team API key's key ID is the
issuer ID. Do not call a generated `.xcodeproj` the source when the repository
uses XcodeGen or another generator.

## 2. iOS/iPadOS/watchOS App Store and TestFlight

The normal ladder is:

1. Run the repository's focused tests, target builds, UI tests, and device gates.
2. Generate the project if required, then create a distribution archive for the
   intended target and destination. Mac Catalyst/iPad and Mac Catalyst/Mac
   archives are separate products when applicable.
3. Validate/export with Xcode's distribution workflow or the repository's
   proven CLI path. Record validation warnings and errors, not only exit code.
4. Inspect the resulting IPA/app: version and build, bundle IDs, embedded
   extensions/watch app, architectures, provisioning, signatures, entitlements,
   privacy manifests, usage descriptions, `get-task-allow`, and production vs
   development CloudKit environment.
5. Upload through the simplest authenticated path supported by the current
   repository and Apple docs. Xcode is preferred for ordinary distribution;
   Transporter/JWT or `xcrun altool` may be used when the repo has a tested path.
   Keep API private keys in their secure store. Team API-key flows require both
   key ID and issuer ID; app-specific passwords are not interchangeable with
   team API keys.
6. Wait for Apple's server-side processing. `upload succeeded` means transfer,
   not TestFlight availability. Record the Apple build/status and any warnings.
7. Resolve export-compliance and encryption questions before assigning or
   submitting the build. A build marked Missing Compliance is not ready.
8. Add the exact build to an internal TestFlight group, install it, and exercise
   the real primary journeys on the intended physical device(s).
9. For external testers, provide beta test information and submit the first
   build for TestFlight beta review when Apple requires it. Record approval,
   rejection, or pending status separately from the upload.
10. For App Review, complete platform-specific metadata, screenshots/previews,
    age rating, privacy details, export compliance, contact/reviewer notes,
    durable demo credentials where login is required, and a reproducible test
    path. Select the processed build, add it to the platform submission, and
    record App Review status and messages.

After authorization, continue automatically through upload polling, compliance
checks, build assignment, and available local/browser/device verification. Use
the regular signed-in Chrome profile for App Store Connect or Developer portal
steps that cannot be completed through a supported CLI/API. Ask the user only
when Apple requires an unavoidable human action such as 2FA, an agreement,
account recovery, or a physical-device interaction that is not available.

## 3. macOS distribution

Choose the channel before signing:

### Mac App Store/TestFlight

Use the Mac App Store distribution configuration and App Store Connect flow.
The App Store process supplies the equivalent security review; do not invent a
Developer ID notarization gate for a Mac App Store build. Still verify archive,
upload, processing, compliance, TestFlight, and App Review gates.

### Direct download

1. Archive/export with a `Developer ID Application` identity and the intended
   direct-distribution entitlements.
2. Verify every nested executable and bundle, hardened runtime, secure
   timestamp, absence of true `com.apple.security.get-task-allow`, correct
   entitlements, and no debug/provisioning leakage.
3. Package the app as the intended DMG/ZIP/PKG, then sign the distributable
   package where the channel requires it.
4. Submit with `xcrun notarytool` or the Notary API using Keychain-backed
   credentials. `altool` is not the current notary path.
5. Read the notary log even after success; warnings can still affect users.
6. Staple with `xcrun stapler staple`, validate with `xcrun stapler validate`,
   and check Gatekeeper with `spctl` on a clean or suitably isolated Mac.
7. Reopen, install, update, uninstall, and launch the exact packaged artifact.

Notarization is automated malware/code-signing assessment, not App Review. A
notarized DMG is not an App Store release.

## 4. Apple account and support diagnosis

When blocked, classify the blocker before changing anything:

- membership, agreements, tax/banking, legal entity, or compliance review;
- team role or app access;
- certificate, App ID, capability, entitlement, or provisioning mismatch;
- unsupported Xcode/SDK/upload requirement;
- invalid binary or missing compliance;
- Apple processing, TestFlight beta review, App Review, or tester assignment;
- local Keychain, Xcode, network, or credential failure.

Capture the exact platform, version/build, timestamp, delivery ID, status, and
sanitized log excerpt. Never paste private keys or passwords into a support
case. Use Apple's Feedback Assistant or Developer Support when App Store
status is unclear, and include the version/build, upload time, and relevant
logs as Apple requests.

When a blocker occurs, do not restart the conversation with repeated generic
questions. Preserve the preflight facts, name the exact failed gate, try all
safe local alternatives, and return one concise blocker with the smallest
required user action. Resume from the failed gate after that action instead of
repeating completed work.

## 5. Release receipt

Return a table or compact checklist with separate states for:

`source` · `tests` · `archive` · `validation/export` · `artifact inspection` ·
`upload` · `Apple processing` · `export compliance` · `TestFlight assignment` ·
`physical install/journey` · `external beta review` · `App Review` ·
`Developer ID signature` · `notarization` · `stapling` · `Gatekeeper/clean Mac`

Only call a channel released when all gates relevant to that channel are proven.

## Current official references

Check these pages live when the workflow is drift-sensitive:

- [Distributing apps for beta testing and releases](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases/)
- [Preparing apps for distribution](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
- [App Store Connect: upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)
- [App build statuses](https://developer.apple.com/help/app-store-connect/reference/app-build-statuses/)
- [Export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
- [Submitting for App Review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Generating App Store Connect API tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- [Creating App Store Connect API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Customizing notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [Capabilities overview](https://developer.apple.com/help/account/capabilities/capabilities-overview)
