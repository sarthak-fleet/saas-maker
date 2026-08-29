---
name: apple-native
description: Build, review, test, and qualify Swift or SwiftUI applications across iOS, iPadOS, macOS, and watchOS. Covers Xcode and XcodeGen projects, platform boundaries, entitlements, simulator and physical-device QA, native accessibility, lifecycle, sync, and release preparation. Use for implementation or native product QA, not upload operations.
---

# Apple-native engineering and QA

## Start with the repository

Read the nearest `AGENTS.md`, `README`, product/design context, project status,
and the project generator source. Inspect the schemes and targets before
editing. Check the installed toolchain with read-only commands such as:

```bash
xcode-select -p
xcodebuild -version
xcodebuild -showsdks
xcodebuild -project <project>.xcodeproj -list
```

Use the repository's package manager and test scripts. If the repository says
not to run terminal `xcodebuild`, use its documented Xcode or non-Xcode path.
Do not weaken signing, entitlements, or production configurations merely to
make a local build pass; use an explicitly named local-only configuration.

## Implementation rules

- Treat SwiftUI, UIKit, AppKit, and Apple's current design resources as the
  upstream Apple UI system. Start with native controls, containers, navigation,
  presentation, typography, symbols, materials, and accessibility behavior; do
  not import a monolithic third-party visual kit to make an Apple app resemble a
  web product. Bridge to UIKit or AppKit when SwiftUI lacks a mature native
  capability. Add a focused package only for a concrete missing behavior, not
  as the default design language.
- Keep platform differences behind clear platform boundaries. Share domain
  logic and design tokens where they are truly shared; do not force iPhone,
  Mac, and Watch into one cramped screen model.
- Treat SwiftData/Core Data/CloudKit schema changes as runtime compatibility
  work. Check optionality, defaults, migrations, containers, environments, and
  sync behavior rather than trusting compilation.
- Treat capabilities and entitlements as a contract: iCloud/CloudKit, App
  Groups, push, Sign in with Apple, HealthKit, widgets, Live Activities, and
  other services must agree across target settings, entitlements, App IDs, and
  provisioning profiles.
- Prefer native controls and platform conventions. Validate Dynamic Type,
  VoiceOver, keyboard navigation on Mac, pointer/hover behavior, focus, touch
  targets, reduced motion, dark/light appearance, localization expansion, and
  permission denial paths.
- Test real content and lifecycle transitions: empty, loading, error, offline,
  slow sync, background/foreground, termination/relaunch, device rotation or
  window resizing, sleep/wake, interrupted sessions, and account changes.

## Verification ladder

Run the smallest relevant check first, then widen only when it passes:

1. Swift package or focused unit tests.
2. Compile the changed target and its extensions.
3. UI tests for the primary flow and the most important failure path.
4. Simulator runs on representative iPhone/iPad/Mac configurations.
5. Physical-device verification for capabilities that simulators cannot prove:
   push, CloudKit production behavior, Sign in with Apple, camera, sensors,
   background execution, Live Activities, Watch communication, and real
   performance or thermal behavior.
6. Capture screenshots or recordings with the exact OS, device/window size,
   build, seed data, and entry path. Keep demo data isolated from user data.

For Mac, inspect compact, standard, wide, and tall windows; menus, commands,
keyboard shortcuts, focus rings, toolbar states, multi-window behavior,
sidebar resizing, and full-screen/restore behavior. For Watch, qualify it as a
focused remote or companion where appropriate, not automatically as a small
copy of the iPhone app.

## Release preparation handoff

Before handing work to `apple-release`, record:

- source commit and generated-project state;
- schemes, configurations, bundle IDs, marketing version, and build numbers;
- target matrix and test commands/results;
- entitlements and capabilities intentionally required;
- privacy manifests, usage descriptions, export-compliance facts, and any
  reviewer test account or notes;
- known limitations and physical-device checks still pending.

The release skill owns archive, upload, Apple processing, TestFlight, App Review,
and notarization. This skill owns whether the app is technically and
experientially ready to enter those gates.

For platform-specific UI decisions, consult Apple's current [Human Interface
Guidelines](https://developer.apple.com/design/human-interface-guidelines/) and
keep the project's `DESIGN.md` and product context authoritative where they are
more specific.
