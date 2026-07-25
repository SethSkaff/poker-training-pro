/**
 * Gameplay-surface message fragment: PokerTable, RoomFlythrough,
 * PlayableTutorial, Dashboard (home/mode-select/timed/tour/record/ceremony),
 * and the contextual coach prompts. Spread into `EN_US_MESSAGES.messages` in
 * `en-US.messages.ts`. Kept in its own module so gameplay-surface copy work
 * does not collide with the shell/settings message additions landing in the
 * same shared registry file.
 */
export const EN_US_GAMEPLAY_MESSAGES = Object.freeze({
  // Shared brand/decorative copy reused across the home screen, mode select,
  // and the room fly-through.
  "brand.name": "Poker Training Pro",
  "brand.tagline": "Championship Series",

  // Shared across PokerTable and PlayableTutorial.
  "cards.faceDown": "Face-down card",
  "shared.opponentPresentationSpeed": "Opponent presentation speed",

  // Poker mode names/descriptions shared between Dashboard's mode select and
  // PokerTable's mode preview panel.
  "modes.normal.tag": "Adaptive tournament field",
  "modes.normal.name": "Normal",
  "modes.normal.description":
    "Strong opponents with pressure, personalities, and selective bluffs.",
  "modes.rational.tag": "Mathematical tournament field",
  "modes.rational.name": "Rational",
  "modes.rational.description":
    "Range-aware opponents following explicit information-set policy.",
  "modes.training.tag": "One decision at a time",
  "modes.training.name": "Training",
  "modes.training.description":
    "Focused poker situations with one linked math question and feedback.",
  "modes.timed.tag": "Fit a table into your schedule",
  "modes.timed.name": "Timed Table",
  "modes.timed.description":
    "Normal opponents at one table for the time you choose.",
  "modes.normalTour": "Normal Tour",
  "modes.rationalTour": "Rational Tour",

  // --- Dashboard.tsx -------------------------------------------------------
  "dashboard.home.title": "Poker Training Pro main menu",
  "dashboard.home.navLabel": "Main menu",
  "dashboard.home.chipsOnly": "Play chips only",
  "dashboard.home.noRealMoney": "No real-money wagering",
  "dashboard.home.creditsLink": "Credits & licenses",

  "dashboard.nav.backToMenu": "Main menu",
  "dashboard.nav.backToModes": "Choose mode",
  "dashboard.nav.backToTours": "Choose tour",

  "dashboard.modeSelect.title": "Choose a mode",
  "dashboard.modeSelect.tutorialPrompt": "New to the table?",
  "dashboard.modeSelect.tutorialCta": "Learn the basics",

  "dashboard.timed.title": "How much time do you have?",
  "dashboard.timed.presetsAriaLabel": "Session length presets",
  "dashboard.timed.minUnit": "min",
  "dashboard.timed.customLabel": "Custom minutes",
  "dashboard.timed.rangeHelp": "Choose a whole number from 5 to 180 minutes.",
  "dashboard.timed.note":
    "One table · Normal opponents · No career progression",
  "dashboard.timed.start": "Start",

  "dashboard.tour.title": "Championship road",
  "dashboard.tour.eventsAriaLabel": "Tournament events",
  "dashboard.tour.locked": "Locked",
  "dashboard.tour.qualifiedStatus": "{finishPlace} of {fieldSize} · Qualified",
  "dashboard.tour.retryStatus": "{finishPlace} of {fieldSize} · Retry",
  "dashboard.tour.available": "Available",
  "dashboard.tour.startingStack": "Starting stack",
  "dashboard.tour.openingBlinds": "Opening blinds",
  "dashboard.tour.localField": "Local field",
  "dashboard.tour.playersCount": "{count} players",
  "dashboard.tour.advance": "Advance",
  "dashboard.tour.lastResult": "Last result: {finishPlace} of {fieldSize}{suffix}",
  "dashboard.tour.qualifiedSuffix": " — qualified",
  "dashboard.tour.notQualifiedSuffix": " — not qualified",
  "dashboard.tour.playAgain": "Play event again",
  "dashboard.tour.enterEvent": "Enter event",
  "dashboard.tour.connectionPending": "Tournament table connection pending",
  "dashboard.tour.disclosure":
    "Six-seat local simulation. Qualification ratios and blind structure come from the full career event.",

  "dashboard.record.title": "Player record",
  "dashboard.record.tournamentElo": "Tournament Elo",
  "dashboard.record.decisionElo": "Decision Elo",
  "dashboard.record.mathElo": "Math Elo",
  "dashboard.record.practiceHands": "Practice hands",
  "dashboard.record.averageDecision": "Average decision",

  "dashboard.ceremony.champion": "Champion",
  "dashboard.ceremony.qualified": "Qualified",
  "dashboard.ceremony.eliminated": "Eliminated",
  "dashboard.ceremony.handsPlayed": "Hands played",
  "dashboard.ceremony.unlocked": "Unlocked",
  "dashboard.ceremony.nextEvent": "Next event",
  "dashboard.ceremony.reviewKeyHand": "Review key hand",
  "dashboard.ceremony.exportReplay": "Export event replay",
  "dashboard.ceremony.returnToMenu": "Return to menu",
  "dashboard.ceremony.exportedAs": "Redacted replay exported as {fileName}.",
  "dashboard.ceremony.exportedPlain": "Redacted replay exported.",
  "dashboard.ceremony.exportPreparing": "Preparing a redacted replay…",
  "dashboard.ceremony.exportHint":
    "Export a redacted, play-safe replay of this event for a bug report.",

  // --- RoomFlythrough.tsx ---------------------------------------------------
  "flythrough.venue.name": "Championship Room",
  "flythrough.status.preparing": "Preparing the room",
  "flythrough.status.crossing": "Crossing the championship floor",
  "flythrough.status.seating": "Taking your seat",
  "flythrough.route.venue": "Venue",
  "flythrough.route.table": "Table",
  "flythrough.route.yourSeat": "Your seat",
  "flythrough.button.sitDown": "Sit down",
  "flythrough.button.skipArrival": "Skip arrival",
  "flythrough.asset.backgroundLabel": "Championship-room background art",

  "dashboard.asset.startMenuLabel": "Start-menu artwork",
  "dashboard.asset.settingsSelectedLabel": "Settings-selected artwork",
  "dashboard.asset.animatedBackgroundLabel": "Animated start-menu background",

  // --- PlayableTutorial.tsx / playableTutorial.ts --------------------------
  "tutorial.step.peek.eyebrow": "1 · Your private cards",
  "tutorial.step.peek.title": "Peek before you decide",
  "tutorial.step.peek.instruction":
    "Your hole cards belong only to you. Click the cards to reveal them.",
  "tutorial.step.legalAction.eyebrow": "2 · Legal actions",
  "tutorial.step.legalAction.title": "Use only the available choice",
  "tutorial.step.legalAction.instruction":
    "You face no bet, so checking continues for zero chips. Calling is not possible and raising is closed in this practice beat.",
  "tutorial.step.betSizing.eyebrow": "3 · Bet sizing",
  "tutorial.step.betSizing.title": "Choose a legal amount",
  "tutorial.step.betSizing.instruction":
    "The minimum is 400 and your maximum is 1,200. A 600-chip bet is 50% of the 1,200-chip pot.",
  "tutorial.step.showdown.eyebrow": "4 · Hand flow",
  "tutorial.step.showdown.title": "Be patient during an all-in runout",
  "tutorial.step.showdown.instruction":
    "No decision is pending: both players are all-in. Deal the turn and river one at a time, then compare five-card hands at showdown.",
  "tutorial.step.math.eyebrow": "5 · Read the numbers",
  "tutorial.step.math.title": "Chips are not odds",
  "tutorial.step.math.instruction":
    "These four ideas answer different questions. Read them before continuing.",
  "tutorial.step.speed.eyebrow": "6 · Presentation speed",
  "tutorial.step.speed.title": "Set the table’s pace",
  "tutorial.step.speed.instruction":
    "Speed changes how quickly opponents and cards are presented, never the cards, legal actions, or AI policy. Choose any speed except 1×.",
  "tutorial.step.complete.eyebrow": "Tutorial complete",
  "tutorial.step.complete.title": "You are ready for the table",
  "tutorial.step.complete.instruction":
    "You peeked, checked a legal action, sized a bet, waited for showdown, read the core math, and changed presentation speed.",

  "tutorial.card.rankSuit": "{rank} {suit}",
  "tutorial.header.label": "Playable tutorial",
  "tutorial.header.stepProgress": "Step {step} of 6",
  "tutorial.header.restart": "Restart",
  "tutorial.table.ariaLabel": "Guided poker hand",
  "tutorial.pot.blinds": "Blinds {small} / {big}",
  "tutorial.villain.name": "Patient Pat",
  "tutorial.villain.chips": "2,800 chips",
  "tutorial.holeCards.revealedAriaLabel": "Hole cards: ace and king of hearts",
  "tutorial.holeCards.peekAriaLabel": "Peek at hole cards",
  "tutorial.holeCards.clickToPeek": "Click to peek",
  "tutorial.actions.ariaLabel": "Legal poker actions",
  "tutorial.actions.foldUnavailable": "Fold unavailable",
  "tutorial.actions.raiseUnavailable": "Raise unavailable",
  "tutorial.bet.amountLabel": "Bet amount",
  "tutorial.bet.ariaLabel": "Tutorial bet amount",
  "tutorial.bet.output": "{amount} chips · {percent}% pot",
  "tutorial.bet.confirmButton": "Bet {amount}",
  "tutorial.showdown.waitTurn": "The flop is complete. Wait for the turn.",
  "tutorial.showdown.waitRiver":
    "The turn makes your flush. The river still must be dealt before the pot is awarded.",
  "tutorial.showdown.dealTurn": "Deal turn",
  "tutorial.showdown.dealRiverShowdown": "Deal river and show down",
  "tutorial.math.chips.label": "Chips",
  "tutorial.math.chips.desc": "The countable units in stacks and the pot.",
  "tutorial.math.potOdds.desc": "A 400 call to win 2,000 total costs 20%.",
  "tutorial.math.equity.desc": "Your estimated share of the pot at showdown.",
  "tutorial.math.expectedValue.desc":
    "Average chips won or lost across repeated decisions.",
  "tutorial.complete.unscored": "Practice is unscored.",
  "tutorial.complete.nextSteps":
    "Start Training for coached decisions or a Tour for full hands.",
  "tutorial.complete.returnToModes": "Return to modes",

  // --- PokerTable.tsx --------------------------------------------------------
  "table.announce.streetPot": "{street}. Pot {pot}.",
  "table.announce.board": "Board: {cards}.",
  "table.announce.noBoard": "No community cards yet.",
  "table.announce.submittedAction": "You submitted {action}.",
  "table.announce.amountToCall": "{amount} to call.",
  "table.announce.mayCheckOrBet": "You may check or bet.",
  "table.announce.latestPublicAction": "Latest public action: {action}.",

  // --- src/lib/tableAnnouncer.ts (live event announcements) -----------------
  // These are distinct from the "table.announce.*" keys above: the ones
  // above describe the CURRENT state every render; these describe a single
  // EVENT (a blind level changing, a hand resolving, an all-in), each fired
  // exactly once per real transition. See tableAnnouncer.test.ts.
  "table.announce.blindsIncreased": "Blinds increased to {smallBlind}/{bigBlind}.",
  "table.announce.handWinner": "{names} won the pot of {amount}.",
  "table.announce.handWinnerSplit": "{names} split the pot of {amount}.",
  "table.announce.namesJoiner": " and ",
  "table.announce.sidePotFormed": "A side pot was contested this hand.",
  "table.announce.heroAllIn": "You are all-in for {amount}.",
  "table.announce.publicAllIn": "{action}.",

  "table.seat.you": "You",
  "table.seat.folded": "Folded",
  "table.seat.allIn": "All-in",
  "table.seat.out": "Out",
  "table.seat.wonPot": "Won pot",

  // Composed into the seat's accessible name (PlayerSeat aria-label).
  "table.seat.ariaBase": "{name}, {chips} chips, {status}",
  "table.seat.statusFragment.active": "active",
  "table.seat.statusFragment.folded": "folded",
  "table.seat.statusFragment.allIn": "all-in",
  "table.seat.statusFragment.out": "out",
  "table.seat.holdingCardsFragment": ", holding cards",
  "table.seat.betFragment": ", bet {amount}",
  "table.seat.dealerFragment": ", dealer button",

  "table.math.ariaLabel": "Training math question",
  "table.math.eyebrow": "Show your work · Optional",
  "table.math.eloChip": "Math Elo {mathElo}",
  "table.math.useEstimate": "Use an estimate",
  "table.math.placeholder.percent": "33%, 1/3, or 2:1",
  "table.math.placeholder.ratio": "0.6 or 3:5",
  "table.math.placeholder.outs": "Number of outs",
  "table.math.placeholder.chips": "Chip amount",
  "table.math.result.correct": "Inside the range",
  "table.math.result.close": "Near miss",
  "table.math.result.incorrect": "Not quite",
  "table.math.acceptedEstimate": "Accepted estimate: {lower}–{upper}{unit}",
  "table.math.checkEstimate": "Check estimate",
  "table.math.hintTitle": "One linked question",
  "table.math.tolerance": "Accepted tolerance: ±{tolerance}{unit}.",

  "table.feedback.eyebrow": "Decision review",
  "table.feedback.strongDecision": "Strong decision",
  "table.feedback.closeDecision": "Close decision",
  "table.feedback.needsAnotherLook": "Needs another look",
  "table.feedback.decisionEloLabel": "Decision Elo",
  "table.feedback.eloSummary": "{decisionEloAfter} · Math {mathEloAfter} ({mathDelta})",
  "table.feedback.chooseRegret":
    "You chose {action} and gave up {regret}bb versus the modeled best action, {bestAction}.",
  "table.feedback.actionLabel": "Action:",
  "table.feedback.mathLabel": "Math:",
  "table.feedback.timeLabel": "Time:",
  "table.feedback.math.skipped": "skipped",
  "table.feedback.math.correct": "correct",
  "table.feedback.math.nearMiss": "near miss",
  "table.feedback.math.incorrect": "incorrect",
  "table.feedback.reviewButton": "Review",
  "table.feedback.nextHandButton": "Next hand",

  "table.modeTitle.training": "Training Lab",
  "table.modeTitle.rational": "Rational Circuit",
  "table.modeTitle.normal": "Normal Tournament",
  "table.modePreview.timedHeading": "Beat the clock",
  "table.modePreview.tournamentHeading": "Tournament table",
  "table.modePreview.timedCopy":
    "Normal opponents share one escalating table. The blind director increases pressure as your deadline approaches.",
  "table.modePreview.rationalCopy":
    "Opponents follow explicit range, equity, and pot-odds policies. Review their logic after the hand.",
  "table.modePreview.normalCopy":
    "Opponents stay fundamentally sound while changing tempo, bluff frequency, and pressure.",
  "table.modePreview.yourSeat": "Your seat",
  "table.modePreview.playerFallback": "Player",
  "table.modePreview.handSummary":
    "Hand {handNumber} · {playersRemaining} of {fieldSize} players remain",
  "table.modePreview.timeRemainingLabel": "Scheduled time remaining",
  "table.modePreview.blindsRiseNote":
    "Blinds only rise; deadline pressure forces the field toward heads-up.",
  "table.modePreview.infoSetTitle": "Information-set play",
  "table.modePreview.infoSetMessage": "Opponents cannot inspect hidden cards.",

  "table.exit": "Leave table",
  "table.stageAriaLabel": "Six-seat poker table",
  "table.status.scenarioProgress": "Scenario {number} of {total}",
  "table.status.streetPlayersRemain": "{street} · {playersRemaining} players remain",
  "table.pauseButton.ariaLabel": "Pause table",
  "table.audio.unmute": "Unmute table audio",
  "table.audio.mute": "Mute table audio",
  "table.decisionClock.ariaLabel": "Decision time {seconds} seconds",
  "table.decisionClock.visibleLabel": "{seconds}s",

  "table.error.actionUnavailable":
    "That action is not available in this practice scenario.",
  "table.error.mathEstimatePercent":
    "Enter a valid percentage, fraction, or ratio estimate.",
  "table.error.mathEstimateGeneric": "Enter a valid {unit} estimate.",
  "table.recap.callToContinue": "Call {amount} to continue, raise, or fold.",
  "table.recap.checkBetOrFold": "Check, bet, or fold.",

  "table.arrival.progressLabel": "Championship progress",
  "table.arrival.handRemain": "Hand {handNumber} · {playersRemaining} remain",
  "table.arrival.settling": "Settling into the next hand",

  "table.camera.left": "Look one seat left",
  "table.camera.right": "Look one seat right",
  "table.camera.viewLabel": "Table view",

  "table.felt.brand": "PTP · CHAMPIONSHIP",
  "table.felt.dealerLabel": "DEALER",
  "table.readout.potLabel": "Pot",
  "table.readout.blinds": "Blinds {smallBlind}/{bigBlind}",
  "table.communityCards.ariaLabel": "Community cards",
  "table.heroStack.label": "Your stack",
  "table.heroStack.commitment": "In this round {street} · Total this hand {total}",
  "table.heroStack.position": "Position {position}",
  "table.position.button": "BTN",
  "table.position.smallBlind": "SB",
  "table.position.bigBlind": "BB",
  "table.position.utg": "UTG",
  "table.position.cutoff": "CO",
  "table.position.hijack": "HJ",
  "table.position.middle": "MP",

  "table.fold.release": "Release to fold",
  "table.fold.keepDragging": "Keep dragging",

  "table.holeCards.hide": "Hide",
  "table.holeCards.peek": "Peek",
  "table.holeCards.ariaLabel": "{state} hole cards. Drag toward the dealer to fold.",
  "table.holeCards.hideCardsLabel": "Hide cards",
  "table.holeCards.peekInstructions": "Click to peek · Drag up to fold",

  "table.actionContext.toCall": "{amount} to call",
  "table.history.button": "Prior action",
  "table.history.ariaLabel": "Public hand history",
  "table.history.heading": "Public action log",
  "table.history.close": "Close hand history",
  "table.history.empty": "No prior public action this session.",

  "table.action.fold": "Fold",
  "table.action.callAmount": "Call {amount}",
  "table.action.check": "Check",
  "table.action.raiseTo": "Raise to…",

  "table.spectator.actionLocked": "Action locked: {action}",
  "table.spectator.returnTo1x": "Return to 1×",
  "table.spectator.speed2x": "2×",
  "table.spectator.skipToResult": "Skip to result",
  "table.spectator.skipAriaLabel":
    "Skip opponent presentation and continue the hand",

  "table.raise.heading": "Build your raise",
  "table.raise.close": "Close raise controls",
  "table.raise.presetAllIn": "All-in",
  "table.raise.presetMin": "Min",
  "table.raise.presetPercentPot": "{percent}% pot",
  "table.raise.amountAriaLabel": "Raise amount",
  "table.raise.bbSuffix": "{bb} BB",
  "table.raise.confirmAllIn": "Confirm all-in",
  "table.raise.raiseToAmount": "Raise to {amount}",

  "table.coach.badge": "Table tip",
  "table.coach.gotIt": "Got it",
  "table.coach.turnOff": "Turn off tips",

  "table.pause.eyebrow": "Table paused",
  "table.pause.menuTitle": "Take your time",
  "table.pause.controlsTitle": "Table controls",
  "table.pause.settingsTitle": "Table settings",
  "table.pause.remapTitle": "Remap controls",
  "table.pause.referenceTitle": "Poker quick reference",
  "table.pause.resume": "Resume table",
  "table.pause.controlsLink": "Controls & hotkeys",
  "table.pause.referenceLink": "Hand & math reference",
  "table.pause.showTips": "Show first-time table tips",
  "table.pause.replayTips": "Replay contextual tips",
  "table.pause.restartPractice": "Restart practice scenario (unscored)",
  "table.pause.leaveTournament": "Leave scored tournament and return to menu",
  "table.pause.leavePractice": "Leave practice and return to menu",
  "table.pause.remapLink": "Remap controls…",
  "table.pause.back": "Back",
  "table.pause.escHint": "Esc resumes without changing the hand.",

  "table.controls.checkCall": "Check / call",
  "table.controls.customRaise": "Custom raise",
  "table.controls.quickRaiseSizes": "2× / 2.5× / 3× BB",
  "table.controls.potAllIn": "Pot / all-in",
  "table.controls.peekHide": "Peek / hide cards",
  "table.controls.cameraLookDesc": "Look left / right / center",
  "table.controls.opponentSpeedDesc": "Opponent speed",
  "table.controls.controllerHint":
    "Controller: A check/call, X fold, Y raise, LB peek, View pause, d-pad camera. B goes back in menus.",

  "table.settings.masterVolumeLabel": "Master volume",
  "table.settings.muteAll": "Mute all audio",
  "table.settings.reduceMotion": "Reduce motion",
  "table.settings.highContrast": "High contrast and four-color deck",

  "table.handRank.royalFlush": "Royal flush",
  "table.handRank.straightFlush": "Straight flush",
  "table.handRank.fourOfAKind": "Four of a kind",
  "table.handRank.fullHouse": "Full house",
  "table.handRank.flush": "Flush",
  "table.handRank.straight": "Straight",
  "table.handRank.threeOfAKind": "Three of a kind",
  "table.handRank.twoPair": "Two pair",
  "table.handRank.pair": "Pair",
  "table.handRank.highCard": "High card",

  "table.formula.potOdds.label": "Pot odds",
  "table.formula.potOdds.desc": "Call ÷ (pot after your call)",
  "table.formula.equity.label": "Equity",
  "table.formula.equity.desc": "Your estimated share of the pot at showdown",
  "table.formula.spr.label": "SPR",
  "table.formula.spr.desc":
    "Effective stack divided by the pot at the start of the street",
  "table.formula.minRaise.label": "Minimum raise",
  "table.formula.minRaise.desc":
    "At least the size of the last full bet or raise",
  "table.formula.sidePot.label": "Side pot",
  "table.formula.sidePot.desc":
    "Separate chips contested only by players who matched them",
  "table.formula.bubble.label": "Bubble",
  "table.formula.bubble.desc":
    "The last finish before a qualification or prize cutoff",
  "table.formula.workedCall.label": "Worked call",
  "table.formula.workedCall.desc":
    "Calling 200 into a final pot of 800 costs 25%. Continue when estimated equity is above 25%, before tournament-risk adjustments.",
  "table.formula.shortcut.label": "Shortcut",
  "table.formula.shortcut.desc":
    "Nine flush outs from the flop are roughly 36% to improve by the river.",
  "table.formula.ruleOf2And4.label": "Rule of 2 & 4",
  "table.formula.ruleOf2And4.desc": "Outs × 2 for one card; × 4 from the flop",
  "table.formula.expectedValue.label": "Expected value",
  "table.formula.expectedValue.desc":
    "Win value − loss cost, weighted by probability",

  "table.footer.checkCall": "Check/Call",
  "table.footer.raise": "Raise",
  "table.footer.peek": "Peek",
  "table.footer.pause": "Pause",
  "table.footer.camera": "Camera",
  "table.footer.peekCards": "Peek cards",
  "table.footer.call": "Call",
  "table.footer.quickRaise": "Quick raise",
  "table.footer.history": "History",

  // --- contextualPrompts.ts -------------------------------------------------
  "prompts.allIn.title": "All-in",
  "prompts.allIn.message":
    "An all-in player cannot wager again. Other players may keep betting if at least two of them still have chips.",
  "prompts.sidePot.title": "Side pot",
  "prompts.sidePot.message":
    "Each player can win only the chips they matched. Extra chips form a side pot contested by the deeper stacks.",
  "prompts.minimumRaise.title": "Minimum raise",
  "prompts.minimumRaise.message":
    "A raise must add at least the size of the previous bet or raise. Smaller increases are illegal, which sets the floor on your raise slider.",
  "prompts.blindIncrease.title": "Blinds went up",
  "prompts.blindIncrease.message":
    "Every stack is now shorter measured in big blinds. Waiting for premium hands costs more each orbit, so wider aggression becomes correct.",
  "prompts.elimination.title": "A player busted",
  "prompts.elimination.message":
    "The field is smaller. The blinds reach you more often and each remaining pot is worth a larger share of the payouts.",
  "prompts.qualification.title": "In the qualifying places",
  "prompts.qualification.message":
    "Surviving now banks the result. Weigh tournament survival against raw chip expected value before committing a big stack.",
  "prompts.eloChange.title": "Your Elo moved",
  "prompts.eloChange.message":
    "Elo tracks decision and math skill against calibrated bots, not chips won. A single hand rarely swings it far, so keep playing your reads.",
  "prompts.shortStack.title": "Short-stack pressure",
  "prompts.shortStack.message":
    "At ten big blinds or fewer, blinds consume your stack quickly. Waiting is still a choice, but each orbit makes it more expensive.",
  "prompts.decisionMistake.title": "Review the decision",
  "prompts.decisionMistake.message":
    "A mistake is useful evidence. Compare the legal choices and their expected value, then retry the unscored scenario.",

  // --- tournamentSession.ts (synthesized in-play scenario text) -------------
  // Per-hand title/prompt/action-reason strings synthesized for Normal/
  // Rational tournament hands, interpolated with the acting player's name
  // and the event/hand numbers. Distinct from the versioned, calibration-
  // gated src/data/trainingScenarios.ts content, which is Training-mode DATA
  // outside this catalog (see PseudoLocaleScreens.test.tsx).
  "tournamentSession.title": "{eventName} · Hand {handNumber}",
  "tournamentSession.prompt.actorDeciding": "{actorName} is deciding.",
  "tournamentSession.prompt.bettingComplete":
    "Betting is complete. Continue the hand.",
  "tournamentSession.actionReason":
    "Tournament decisions are supplied by the selected information-set policy.",

  // --- lifecyclePause.ts (PokerTable's resume-recap panel) ------------------
  "resumeRecap.reasonLabel.manual": "Paused",
  "resumeRecap.reasonLabel.windowBlurred": "Window inactive",
  "resumeRecap.reasonLabel.documentHidden": "Window hidden",
  "resumeRecap.reasonLabel.windowMinimized": "Minimized",
  "resumeRecap.reasonLabel.systemSuspended": "System sleep",
  "resumeRecap.reasonLabel.screenLocked": "Screen locked",
  "resumeRecap.title.withReason": "Resumed from {reason}",
  "resumeRecap.title.plain": "Resumed",
  "resumeRecap.line.hand": "Hand {handNumber}",
  "resumeRecap.line.handStreet": "Hand {handNumber} · {street}",
  "resumeRecap.line.lastAction": "Last action: {action}",
  "resumeRecap.line.pot": "Pot: {chips} chips",
  "resumeRecap.line.potPlayers":
    "Pot: {chips} chips · {playersRemaining} players left",
  "resumeRecap.line.decision": "Your decision: {decision}",
  "resumeRecap.line.awayCounts": "Away for {duration}.",
  "resumeRecap.line.awayExcluded":
    "Away for {duration}; that time was not counted against your play.",
  "resumeRecap.duration.secondSingular": "{count} second",
  "resumeRecap.duration.secondPlural": "{count} seconds",
  "resumeRecap.duration.minuteSingular": "{count} minute",
  "resumeRecap.duration.minutePlural": "{count} minutes",
  "resumeRecap.duration.minutesSeconds": "{minutes} min {seconds} s",

  // --- actionMap.ts (ControlsRemapPanel + the pause-menu remap page) --------
  // Action labels/pointer hints are shared between the Settings controls
  // remap surface and PokerTable's in-hand pause-menu remap page.
  "actionMap.menu.up.label": "Move focus up",
  "actionMap.menu.up.pointerHint": "Move the cursor to the control above",
  "actionMap.menu.down.label": "Move focus down",
  "actionMap.menu.down.pointerHint": "Move the cursor to the control below",
  "actionMap.menu.left.label": "Move focus left / decrease",
  "actionMap.menu.left.pointerHint":
    "Drag a slider left or move to the previous control",
  "actionMap.menu.right.label": "Move focus right / increase",
  "actionMap.menu.right.pointerHint":
    "Drag a slider right or move to the next control",
  "actionMap.menu.activate.label": "Activate",
  "actionMap.menu.activate.pointerHint": "Click the focused control",
  "actionMap.menu.back.label": "Back / close",
  "actionMap.menu.back.pointerHint": "Click Back or the close control",
  "actionMap.game.fold.label": "Fold",
  "actionMap.game.fold.pointerHint":
    "Click Fold, or drag the hole cards toward the dealer",
  "actionMap.game.checkCall.label": "Check / Call",
  "actionMap.game.checkCall.pointerHint": "Click Check / Call",
  "actionMap.game.raiseCustom.label": "Custom raise",
  "actionMap.game.raiseCustom.pointerHint":
    "Click Raise to open the bet composer",
  "actionMap.game.raiseDouble.label": "Raise 2× big blind",
  "actionMap.game.raiseDouble.pointerHint":
    "Choose the 2× preset in the bet composer",
  "actionMap.game.raiseTwoFive.label": "Raise 2.5× big blind",
  "actionMap.game.raiseTwoFive.pointerHint":
    "Choose the 2.5× preset in the bet composer",
  "actionMap.game.raiseTriple.label": "Raise 3× big blind",
  "actionMap.game.raiseTriple.pointerHint":
    "Choose the 3× preset in the bet composer",
  "actionMap.game.pot.label": "Pot-sized raise",
  "actionMap.game.pot.pointerHint": "Choose the pot preset in the bet composer",
  "actionMap.game.allIn.label": "All-in",
  "actionMap.game.allIn.pointerHint": "Choose All-in in the bet composer",
  "actionMap.game.peek.label": "Peek / hide cards",
  "actionMap.game.peek.pointerHint": "Click the hole cards to peek or hide",
  "actionMap.game.history.label": "Hand history",
  "actionMap.game.history.pointerHint": "Click Prior action",
  "actionMap.game.pause.label": "Pause",
  "actionMap.game.pause.pointerHint": "Click the pause control",
  "actionMap.camera.left.label": "Look left",
  "actionMap.camera.left.pointerHint": "Click the look-left control",
  "actionMap.camera.right.label": "Look right",
  "actionMap.camera.right.pointerHint": "Click the look-right control",
  "actionMap.camera.center.label": "Recenter view",
  "actionMap.camera.center.pointerHint": "Click Table view to recenter",
  "actionMap.speed.down.label": "Slow opponents down",
  "actionMap.speed.down.pointerHint": "Lower the speed slider",
  "actionMap.speed.up.label": "Speed opponents up",
  "actionMap.speed.up.pointerHint": "Raise the speed slider",
} as const satisfies Readonly<Record<string, string>>);

export type GameplayMessageKey = keyof typeof EN_US_GAMEPLAY_MESSAGES;
