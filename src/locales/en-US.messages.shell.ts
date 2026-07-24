/**
 * Namespaced English copy for shell/menu/settings surfaces: the title screen,
 * Settings, save data & diagnostics controls, save recovery, credits, about &
 * support, control remapping, the play-chip acknowledgment, App-level
 * startup/loading gates (loading, safe mode, save-failure, import, resume,
 * first-run setup, scene-loading labels), and the tournament career-ladder
 * chrome (event names, tier labels, qualification requirement copy — the
 * naming/categorization labels around the tournament data in
 * src/engine/tournament.ts, NOT the poker situation data itself).
 *
 * Kept in its own module so it can be authored independently of gameplay-
 * surface catalog additions; `en-US.messages.ts` merges this record into the
 * single versioned English resource consumed by `formatMessage`. License and
 * notice text bundled from third-party sources is intentionally NOT here —
 * only the UI chrome around it is.
 */
export const SHELL_MESSAGES = Object.freeze({
  // Shared shell/product copy, reused across several startup-gate screens.
  "shell.productName": "Poker Training Pro",
  "shell.action.exportSave": "Export save",
  "shell.action.exportDiagnostics": "Export diagnostics",
  "shell.action.quitSafely": "Quit safely",

  // Title screen (src/components/TitleScreen.tsx)
  "titleScreen.ariaLabel": "Poker Training Pro title screen",
  "titleScreen.muteMusic": "Mute music",
  "titleScreen.unmuteMusic": "Unmute music",
  "titleScreen.pressAnyKey": "Press any key",
  "titleScreen.playChipDisclosure": "Play chips only · No real-money wagering",

  // Settings (src/components/SettingsPanel.tsx)
  "settings.header.backToMainMenu": "Main menu",
  "settings.header.sectionLabel": "System",
  "settings.header.controllerHint":
    "Controller: D-pad move · A select · B back · D-pad ←/→ adjust sliders",
  "settings.audio.heading": "Audio",
  "settings.audio.previewStatusDefault":
    "Choose Preview to hear the saved Master or Table effects level.",
  "settings.audio.buttonPreview": "Preview",
  "settings.audio.buttonUnavailable": "Unavailable",
  "settings.audio.volumeAriaLabel": "{label} volume",
  "settings.audio.muteAll.label": "Mute all audio",
  "settings.audio.muteAll.description":
    "Silence music and table effects without changing their levels.",
  "settings.audio.master.label": "Master",
  "settings.audio.master.description":
    "Controls the combined level of all available game audio.",
  "settings.audio.master.previewLabel": "Preview Master volume at {percent} percent",
  "settings.audio.music.label": "Music",
  "settings.audio.music.description":
    "Preview unavailable — no approved licensed music masters are installed.",
  "settings.audio.music.previewUnavailableLabel": "Music preview unavailable",
  "settings.audio.effects.label": "Table effects",
  "settings.audio.effects.description":
    "Controls card, chip, fold, and result cues.",
  "settings.audio.effects.previewLabel": "Preview Table effects volume at {percent} percent",

  // Audio preview result feedback (src/lib/audioPreview.ts)
  "audioPreview.masterPlayed": "Master preview played at {percent} percent.",
  "audioPreview.effectsPlayed":
    "Table effects preview played at {percent} percent.",
  "audioPreview.silent": "Preview is silent. {reason}",
  "audioPreview.reason.mutedAll": "Mute all audio is on.",
  "audioPreview.reason.masterZero": "Master volume is zero.",
  "audioPreview.reason.effectsZero": "Table effects volume is zero.",
  "audioPreview.reason.temporarilyPaused": "Audio is temporarily paused.",
  "audioPreview.unavailable":
    "Audio preview is unavailable on this device. Your settings were kept.",

  "settings.display.heading": "Display",
  "settings.display.fullscreen.label": "Fullscreen",
  "settings.display.fullscreen.description": "Alt + Enter also changes display mode.",
  "settings.display.reduceMotion.label": "Reduce motion",
  "settings.display.reduceMotion.description":
    "Use quiet fades instead of camera and object travel.",
  "settings.display.highContrast.label": "High contrast & four-color deck",
  "settings.display.highContrast.description":
    "Strengthen table edges and distinguish every suit.",
  "settings.display.interfaceScale.heading": "Interface size",
  "settings.display.interfaceScale.compact": "Compact",
  "settings.display.interfaceScale.standard": "Standard",
  "settings.display.interfaceScale.large": "Large",
  "settings.display.interfaceScale.extraLarge": "Extra large",
  "settings.display.interfaceScale.hint":
    "Changes the size of menus, table labels, and action controls. You can scroll a larger interface; gameplay information is never hidden.",
  "settings.dealSpeed.heading": "Deal speed",
  "settings.camera.heading": "Table camera",
  "settings.camera.autoMovement.label": "Automatic camera movement",
  "settings.camera.autoMovement.description":
    "Play the room arrival and recenter your view at the start of a new hand.",
  "settings.camera.sensitivity.heading": "Look sensitivity",
  "settings.camera.view.heading": "Table view",
  "settings.motion.heading": "Motion details",
  "settings.motion.hint":
    "Tune each surface independently. Reduce motion above remains a one-click safety override and temporarily stops every category.",
  "settings.motion.choice.full": "Full",
  "settings.motion.choice.reduced": "Reduced",
  "settings.motion.choice.off": "Off",
  "settings.motion.menu.label": "Menu background",
  "settings.motion.menu.description": "Decorative title and selection movement.",
  "settings.motion.room.label": "Room arrival",
  "settings.motion.room.description":
    "The championship-floor approach before a seat is shown.",
  "settings.motion.camera.label": "Camera movement",
  "settings.motion.camera.description":
    "Automatic recentering and the eased table-view response.",
  "settings.motion.table.label": "Card and chip flourish",
  "settings.motion.table.description":
    "Deal, fold, chip-push, and opponent thinking effects.",
  "settings.motion.transition.label": "Screen transitions",
  "settings.motion.transition.description":
    "Mode changes and the between-hand progress overlay.",
  "settings.controls.heading": "Controls",
  "settings.controls.hint":
    "Rebind keyboard and controller actions. Conflicts and reserved system keys are flagged; reset either device to its defaults.",
  "settings.footer.resetDefaults": "Reset defaults",

  // Save data & diagnostics (src/components/SaveDataControls.tsx)
  "saveData.heading": "Save data & diagnostics",
  "saveData.intro":
    "Desktop progress is stored in a protected local journal. Browser storage is never used as the authoritative desktop save.",
  "saveData.status.default":
    "Exports are local files. Import and reset always require a preview and confirmation.",
  "saveData.status.working": "Working…",
  "saveData.error.generic": "The data operation could not be completed.",
  // Save-backup format validation/migration failures (src/lib/saveMigration.ts)
  "saveData.error.invalidJson": "The backup is not valid JSON.",
  "saveData.error.invalidPayload": "The backup must contain an object.",
  "saveData.error.unknownFormat":
    "The backup belongs to an unknown application or save format.",
  "saveData.error.unsupportedVersion":
    "This backup was created by an unsupported save version.",
  "saveData.error.versionedIncomplete":
    "The versioned backup is missing settings or player progress.",
  "saveData.error.legacyIncomplete":
    "The legacy backup does not contain settings or player progress.",
  "saveData.error.lastKnownGoodWriteFailed":
    "The last-known-good backup could not be written.",
  "saveData.error.lastKnownGoodReadFailed":
    "The last-known-good backup could not be read.",
  "saveData.error.lastKnownGoodUnavailable":
    "No last-known-good backup is available.",
  "saveData.button.importSave": "Import save…",
  "saveData.button.resetProgress": "Reset player progress…",
  "saveData.button.exportReplay": "Export public replay",
  "saveData.replay.unavailableTitle": "Complete or start a tournament first.",
  "saveData.export.successNamed": "Save exported as {fileName}.",
  "saveData.export.success": "Save exported.",
  "saveData.diagnostics.successNamed": "Redacted diagnostics exported as {fileName}.",
  "saveData.diagnostics.success": "Redacted diagnostics exported.",
  "saveData.import.success": "Imported save validated and loaded.",
  "saveData.reset.success": "Player progress reset. Audio and display settings were preserved.",
  "saveData.replay.success": "Public replay exported as {fileName}.",
  "saveData.confirm.importTitle": "Confirm imported save",
  "saveData.confirm.resetTitle": "Confirm progress reset",
  "saveData.confirm.importPreview":
    "This valid save contains {resultCount} recorded results and {trainingCompleted} completed training hands. Ratings: decision {decisionElo}, math {mathElo}, tournament {tournamentElo}. It will replace both settings and progress.",
  "saveData.confirm.resetPreview":
    "This will archive the current save, clear {resultCount} recorded results and {trainingCompleted} completed training hands, and preserve audio and display settings.",
  "saveData.confirm.importAction": "Import this save",
  "saveData.confirm.resetAction": "Archive and reset progress",

  // Durable save failures (src/lib/durablePersistence.ts) — surfaced as
  // DurableFailure.message in RecoveryScreen and SaveDataControls. Distinct
  // from the saveData.error.* keys above: those describe a save-backup
  // format validation/migration failure raised directly by
  // src/lib/saveMigration.ts with its own specific wording; these describe
  // the durable-journal read/write/IPC failure paths (disk/quota/permission,
  // stale confirmations, replay export, "operation unavailable in this
  // build"), which intentionally use their own, sometimes-similar English
  // copy rather than reusing the saveMigration wording.
  "durable.error.noPendingRetry": "There is no pending save to retry.",
  "durable.error.restoreUnavailable":
    "Restore is not available in this desktop build.",
  "durable.error.startFreshUnavailable":
    "Start Fresh is not available in this desktop build.",
  "durable.error.exportUnavailable":
    "Save export is not available in this desktop build.",
  "durable.error.diagnosticsUnavailable":
    "Diagnostic export is not available in this desktop build.",
  "durable.error.importUnavailable":
    "Save import is not available in this desktop build.",
  "durable.error.resetUnavailable":
    "Progress reset is not available in this desktop build.",
  "durable.error.replayExportUnavailable":
    "Replay export is not available in this desktop build.",
  "durable.error.createdByNewerVersion":
    "This save was created by a newer version of the app.",
  "durable.error.unknownApplicationOrFormat":
    "This save belongs to an unknown application or format.",
  "durable.error.progressNotValidated":
    "The saved progress could not be validated.",
  "durable.error.diskFull":
    "The save could not be written because the device is full.",
  "durable.error.quotaExceeded": "The storage quota was exceeded.",
  "durable.error.permissionDenied":
    "The save location is unavailable or read-only.",
  "durable.error.readFailed": "The saved progress could not be read.",
  "durable.error.generationInvalidJson":
    "A save generation contains incomplete or invalid data.",
  "durable.error.generationInvalidRecord":
    "A save generation has an invalid format.",
  "durable.error.generationChecksumMismatch":
    "A save generation failed its integrity check.",
  "durable.error.noValidGeneration":
    "No valid save generation could be loaded.",
  "durable.error.foreignSave":
    "The selected file belongs to another application.",
  "durable.error.cyclicSave": "The selected save contains cyclic data.",
  "durable.error.importTooLarge":
    "The selected save is too large to import.",
  "durable.error.importChanged":
    "The selected save changed after preview. Choose it again.",
  "durable.error.saveChanged":
    "Progress changed after preview. Review the reset again.",
  "durable.error.invalidConfirmation":
    "The confirmation expired or was already used.",
  "durable.error.invalidCurrentSave":
    "Current settings could not be validated safely.",
  "durable.error.invalidReplay": "The replay could not be validated.",
  "durable.error.replayTooLarge": "The replay is too large to export.",
  "durable.error.developerExportDisabled":
    "Developer replay export is unavailable in this build.",
  "durable.error.pickerFailed":
    "The replay destination could not be selected.",
  "durable.error.cancelled": "The operation was cancelled.",
  "durable.error.writeFallback":
    "Progress could not be saved. It remains ready to retry.",
  "durable.error.genericFallback":
    "The save operation could not be completed.",
  "durable.error.recoveryCopyAvailable":
    "The latest save could not be used. A recovery copy is available.",
  "durable.error.previousSaveRestorable":
    "The latest save could not be used. The previous save can be restored.",
  "durable.error.browserImportDamaged":
    "Existing browser progress is damaged and was not imported or replaced.",
  "durable.error.browserQuotaExceeded":
    "Browser storage quota prevented the legacy import.",
  "durable.error.browserAccessUnavailable":
    "Browser storage access is unavailable.",
  "durable.error.browserReadFailed": "Browser storage could not be read.",

  // Save recovery (src/components/RecoveryScreen.tsx)
  "recovery.eyebrow": "Save recovery",
  "recovery.title": "Your progress is still protected",
  "recovery.preview.ariaLabel": "Recovery save preview",
  "recovery.preview.playerLabel": "Player",
  "recovery.preview.trainingCompletedLabel": "Training complete",
  "recovery.preview.savedLabel": "Saved",
  "recovery.preview.savedFallback": "Recovery copy",
  "recovery.busy.restore": "Restoring your protected save…",
  "recovery.busy.exportSave": "Exporting your save…",
  "recovery.busy.exportDiagnostics": "Exporting recovery diagnostics…",
  "recovery.busy.startFresh": "Archiving the old save and starting fresh…",
  "recovery.error.generic": "The recovery action could not be completed.",
  "recovery.action.restorePrevious": "Restore previous save",
  "recovery.action.restoreLastKnownGood": "Restore last-known-good save",
  "recovery.action.startFresh": "Start fresh",
  "recovery.action.cancelWithoutChanges": "Cancel without changes",
  "recovery.confirm.startFreshLabel":
    "Starting fresh archives existing save files before creating a new profile. Nothing is discarded silently. Continue?",
  "recovery.confirm.startFreshAction": "Archive and start fresh",
  "recovery.confirm.keepProgress": "Keep my progress",

  // Credits (src/components/CreditsScreen.tsx) — UI chrome only; bundled
  // license/notice text itself stays verbatim from its source files. Section
  // titles/notes and version-row/document labels assembled by
  // src/lib/creditsData.ts (assembleCredits) also live here. Font labels
  // that pair a font's proper name with its license name (e.g. "Inter —
  // SIL Open Font License 1.1") are intentionally NOT migrated — they are
  // proper nouns/license identifiers, not composed UI prose.
  "credits.eyebrow": "About",
  "credits.title": "Credits & licenses",
  "credits.document.unavailable":
    "This notice is bundled with the installed app and is unavailable in this preview.",
  "credits.section.application.title": "Application",
  "credits.section.application.note":
    "Version and runtime identifiers for this build.",
  "credits.versionRow.buildId": "Build identifier",
  "credits.versionRow.electron": "Electron",
  "credits.versionRow.chromium": "Chromium",
  "credits.versionRow.nodeJs": "Node.js",
  "credits.section.fonts.title": "Fonts",
  "credits.section.fonts.note":
    "Bundled local fonts under the SIL Open Font License 1.1.",
  "credits.document.label.thirdPartyPackages": "npm package notices",
  "credits.document.label.thirdPartyRuntime": "Bundled runtime notices",
  "credits.section.packages.title": "Open-source software",
  "credits.section.packages.note":
    "Notices for the npm packages compiled into this build. These are " +
    "bundled copies, shown offline; nothing is fetched.",
  "credits.section.music.title": "Music",
  "credits.section.music.note":
    "No instrumental soundtrack is included yet. When licensed tracks " +
    "ship, each track's title, author, source, and license will appear " +
    "here.",
  "credits.musicStatus":
    "No licensed music ships in this build. Background music stays disabled " +
    "until instrumental masters are licensed, loudness-normalised, and " +
    "attributed here.",

  // About & support (src/components/AboutSupport.tsx) — UI chrome only.
  "about.heading": "About & support",
  "about.versionLabel": "Version",
  "about.buildIdLabel": "Build identifier",
  "about.unavailable": "Unavailable",
  "about.folder.opened": "Opened the {target} folder.",
  "about.folder.failed": "The {target} folder could not be opened.",
  "about.saveLocationLabel": "Save location",
  "about.logLocationLabel": "Log location",
  "about.openFolder": "Open folder",
  "about.privacyHeading": "Privacy",
  "about.privacyIntro":
    "This build plays fully offline with no account, ads, analytics, or remote uploads. The full policy is bundled below.",
  "about.privacyPolicySummary": "Privacy policy",
  "about.privacyPolicyUnavailable":
    "The bundled privacy policy is unavailable in this preview.",
  "about.privacyPolicyBlocked":
    "A stable public HTTPS copy of this policy is a separate item that is still blocked pending the publisher.",
  "about.supportHeading": "Support",
  "about.supportBlocked":
    "Support contact: pending publisher assignment. No email or web address is published yet.",
  "about.desktopUnavailable":
    "Version, folder, and bundled-document details are available in the desktop app.",
  "about.diagnostics.failed": "Diagnostics export failed.",

  // Control remapping (src/components/ControlsRemapPanel.tsx)
  "controls.panel.ariaLabel": "Control remapping",
  "controls.category.menu": "Menus & dialogs",
  "controls.category.gameplay": "Betting & cards",
  "controls.category.camera": "Camera",
  "controls.category.speed": "Opponent speed",
  "controls.category.system": "System",
  "controls.tabs.ariaLabel": "Input device",
  "controls.device.keyboard": "Keyboard",
  "controls.device.controller": "Controller",
  "controls.reset.button": "Reset {device} to defaults",
  "controls.conflict.alert":
    "Some {device} controls share a binding. Duplicate controls are highlighted below.",
  "controls.action.unbound": "Unbound",
  "controls.action.rebindButton": "Rebind",
  "controls.action.rebindAriaLabel": "Rebind {actionLabel} for {device}",
  "controls.reserved.title": "Reserved system key",
  "controls.reserved.label": "reserved",
  "controls.capture.eyebrow": "Listening for input",
  "controls.capture.title": "Press a {inputKind} for “{actionLabel}”",
  "controls.capture.inputKind.key": "key",
  "controls.capture.inputKind.controllerButton": "controller button",
  "controls.capture.instructionsKeyboard": "Press any key to bind it. Press Esc to cancel.",
  "controls.capture.instructionsGamepad": "Press any controller button to bind it.",
  "controls.capture.reservedNotice":
    "{keyName} is a reserved system key. Choose another key or press Esc to cancel.",

  // Play-chip acknowledgment (src/components/PlayChipAcknowledgment.tsx)
  "playChipAck.eyebrow": "Before you play",
  "playChipAck.title": "These are play chips",
  "playChipAck.body":
    "Poker Training Pro is a poker trainer. Play chips only. Chips have no cash value, and there is no real-money wagering, no deposits, no purchases, and no withdrawals. There is nothing to win or lose but practice.",
  "playChipAck.followUp":
    "This message appears once. You can revisit the details any time from Settings.",
  "playChipAck.acknowledgeButton": "I understand — continue",
  "playChipAck.backButton": "Back to menu",

  // App shell — startup/loading gates (src/App.tsx)
  "shell.loading.title": "Loading your table…",
  "shell.loading.detail": "Checking the protected desktop save journal.",
  "shell.loading.trainingTable": "Loading the training table…",
  "shell.loading.tutorial": "Loading the tutorial…",
  "shell.loading.tournamentTable": "Loading the tournament table…",
  "shell.loading.enteringEvent": "Entering {eventName}…",
  "shell.error.tournamentReplayFailed":
    "The saved tournament checkpoint could not be replayed. Your ratings and training progress are still safe.",
  "shell.safeMode.eyebrow": "Recovery launch",
  "shell.safeMode.title": "Safe mode is protecting this session",
  "shell.safeMode.description":
    "Poker Training Pro detected repeated startup or renderer failures. Hardware acceleration is disabled, animation is reduced, audio is muted, and quick dealing is forced for this launch. Your saved preferences and poker progress have not been replaced.",
  "shell.safeMode.recoveryCountRepaired":
    "Recovery count: {failureCount}. A damaged recovery marker was repaired.",
  "shell.safeMode.recoveryCountValid":
    "Recovery count: {failureCount}. The recovery marker passed validation.",
  "shell.safeMode.continueButton": "Continue in safe mode",
  "shell.import.eyebrow": "Progress found",
  "shell.import.title": "Bring your browser progress to desktop?",
  "shell.import.summary":
    "Player {playerName} has completed {trainingCompleted} training scenarios across {resultCount} recorded results.",
  "shell.import.importButton": "Import progress",
  "shell.saveFailure.eyebrow": "Save interrupted",
  "shell.saveFailure.title": "Your last move is paused",
  "shell.saveFailure.detail":
    "Gameplay is blocked until the protected save succeeds, so your progress cannot silently diverge from disk.",
  "shell.saveFailure.retryButton": "Retry save",
  "shell.firstRun.eyebrow": "First-time setup",
  "shell.firstRun.title": "Make the table comfortable",
  "shell.firstRun.intro":
    "Choose a quiet starting setup before camera motion or timed play begins. You can change every option later in Settings.",
  "shell.firstRun.reduceMotion.label": "Reduce motion",
  "shell.firstRun.reduceMotion.description":
    "Replace room travel and card movement with calm fades.",
  "shell.firstRun.highContrast.label": "High contrast and four-color deck",
  "shell.firstRun.highContrast.description":
    "Strengthen edges and distinguish suits without color alone.",
  "shell.firstRun.startMuted.label": "Start muted",
  "shell.firstRun.startMuted.description":
    "All decisions remain fully readable without audio.",
  "shell.firstRun.keyboardHint":
    "Keyboard: arrow keys and Tab navigate menus; Space/Enter activate; F folds, C calls/checks, 2 raises double, R raises custom, and Esc pauses.",
  "shell.firstRun.saveButton": "Save and continue",
  "shell.firstRun.skipButton": "Skip setup",
  "shell.resumeTournament.eyebrow": "Tournament checkpoint",
  "shell.resumeTournament.title": "Return to your saved seat?",
  "shell.resumeTournament.summary":
    "{eventName} is waiting at hand {handNumber}. The deck and decisions were reconstructed from the protected seed and public action log.",
  "shell.resumeTournament.resumeButton": "Resume tournament",
  "shell.resumeTournament.abandonButton": "Abandon checkpoint and go to menu",
  "shell.resumeTraining.eyebrow": "Training checkpoint",
  "shell.resumeTraining.title": "Return to your saved scenario?",
  "shell.resumeTraining.fallbackScenarioTitle": "Your saved Training scenario",
  "shell.resumeTraining.summary":
    "{scenarioTitle} is ready at the table. Your answer and score have not been submitted yet.",
  "shell.resumeTraining.resumeButton": "Resume Training",
  "shell.resumeTraining.abandonButton": "Abandon scenario and go to menu",

  // Tournament career ladder (src/engine/tournament.ts CAREER_EVENTS,
  // consumed by src/modes/tournamentSession.ts and rendered by
  // src/components/Dashboard.tsx's career-tour event list/detail board).
  // These are naming/categorization labels, not calibrated poker content —
  // see TODOS.md string-extraction verdict for the reasoning.
  "career.event.local-qualifier": "Local Qualifier",
  "career.event.regional-open": "Regional Open",
  "career.event.circuit-main": "Circuit Main Event",
  "career.event.national-championship": "National Championship",
  "career.event.world-championship": "World Championship",
  "career.tier.local": "Local",
  "career.tier.regional": "Regional",
  "career.tier.circuit": "Circuit",
  "career.tier.championship": "Championship",
  "career.tier.world": "World",
  "career.qualification.winFinal": "Win the six-seat final",
  "career.qualification.topFinish": "Finish in the top {places} of {total}",
  "career.result.placement": "{place} of {total}",
  "career.result.qualified": "Qualified for the next Grand Prix event",
  "career.result.notQualified": "Needed top {qualifyingPlaces} to qualify",
} as const);

export type ShellMessageKey = keyof typeof SHELL_MESSAGES;
