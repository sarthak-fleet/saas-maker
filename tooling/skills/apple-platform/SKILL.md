---
name: apple-platform
description: Route Apple-native application work and Apple distribution work for iOS, iPadOS, macOS, and watchOS. Use when building Swift or SwiftUI apps, testing native targets, preparing archives, shipping through TestFlight or the App Store, notarizing direct-download Mac software, or diagnosing Apple Developer and App Store Connect blockers.
---

# Apple platform

Use this as the entry point for Apple work. Route to the smallest focused
workflow:

| Request | Skill |
|---|---|
| Build or review Swift, SwiftUI, UIKit, AppKit, iOS, macOS, or watchOS code | `../apple-native/SKILL.md` |
| Archive, sign, upload, process, distribute, notarize, submit, or deal with Apple | `../apple-release/SKILL.md` |
| Native UI direction or polish | `../design-workflow/SKILL.md`, then the native skill |

## Shared operating contract

1. Read the nearest `AGENTS.md`, `README`, `PRODUCT.md`, `DESIGN.md`, and
   `PROJECT_STATUS.md` before acting. Treat the owning repository as the source
   of truth.
2. Identify the project source: `.xcodeproj`, `.xcworkspace`, Swift Package,
   `project.yml`/XcodeGen, or another generator. Edit the source and regenerate
   generated projects; never hand-edit generated output.
3. Keep iOS/iPadOS/watchOS App Store distribution, Mac App Store distribution,
   and direct-download Developer ID distribution as separate channels. Their
   entitlements, signing identities, export options, and acceptance gates differ.
4. Keep receipts separate: source/build, tests, archive, validation/export,
   upload, Apple processing, compliance, TestFlight assignment/install, App
   Review, notarization/stapling, and physical-device or clean-machine proof.
   An upload or passing local test is never a release receipt.
5. Never read, print, commit, or place Apple passwords, private API keys,
   provisioning profiles, certificates, or credential contents in source,
   command arguments, logs, screenshots, or memory. Prefer the existing desktop
   Keychain or the user's already-configured local key reference and scoped team
   API keys. The personal Apple Developer/App Store Connect account active on
   this Mac is the default; do not ask the user to choose an account or silently
   switch teams.
6. For drift-prone Apple behavior, check the current official Apple links in the
   focused skill before relying on remembered commands or requirements. Do not
   use third-party tutorials as the authority for signing, App Review, or
   notarization.

## Desktop personal-account mode

Use the user's desktop as the operating environment: installed Xcode, login
Keychain, connected simulators/devices, and the regular signed-in Chrome profile
when Apple Developer or App Store Connect requires browser participation. Use a
clean/isolated browser profile only for an explicitly requested clean-session
test.

Do one complete read-only preflight before asking anything. Once the user has
authorized the requested release, carry that authorization through all in-scope
build, upload, polling, assignment, and verification steps without asking again
at every stage. Stop only for a genuine external blocker such as missing
personal-account access, expired/missing credentials, a required Apple
acceptance/2FA action, or an unavailable physical device; report the blocker and
the single smallest action needed.

## Completion language

Report exactly which gates passed and which remain pending. Use phrases such as
`archive validated`, `upload accepted`, `processing VALID`, `internal TestFlight
installed`, `external beta review approved`, `notarization accepted and ticket
stapled`, and `App Review accepted`; do not collapse these into `released`.
