import { ArrowRight, FastForward } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import {
  FreezableDelay,
  realFreezableDelayHost,
} from "../lib/freezableDelay";
import { useAwayFreezeGroup } from "../lib/desktopLifecycle";
import type { GameSettings } from "../types/poker";
import type { CareerTier } from "../engine";

/**
 * E20-003 — travel between career events.
 *
 * Finishing an event used to drop the player back into a lobby list, which is
 * what made a career read as a menu with tournaments behind it rather than a
 * circuit you move along. This is the connective tissue: the camera leaves the
 * seat, rises above the room, the circuit route is drawn with the marker
 * moving from the event just played to the next one, and the next venue grows
 * to meet the camera before play begins.
 *
 * Staged 2.5D, per E09-001's decision record: one venue vocabulary re-lit and
 * re-dressed per tier, no per-event art, no 3D dependency. Every phase is a
 * class on the root element, so the whole sequence collapses to a single
 * static frame under `roomMotion: "off"` without a second code path.
 */

export interface CareerTravelStop {
  id: string;
  name: string;
  tier: CareerTier;
  /** Whether the player has already qualified out of this event. */
  cleared: boolean;
}

interface CareerTravelProps {
  /** The whole circuit, in order, so the route shows where this leg sits. */
  route: readonly CareerTravelStop[];
  fromEventId: string;
  toEventId: string;
  settings: GameSettings;
  onComplete: () => void;
}

type TravelPhase = "seat" | "rise" | "route" | "approach";

/** Slot centres, matching the lobby route: event i of N sits at (i+0.5)/N. */
function slotPercent(index: number, total: number): number {
  return ((index + 0.5) / Math.max(1, total)) * 100;
}

export function CareerTravel({
  route,
  fromEventId,
  toEventId,
  settings,
  onComplete,
}: CareerTravelProps) {
  const freezeGroup = useAwayFreezeGroup();

  const still =
    settings.reducedMotion ||
    settings.roomMotion === "off" ||
    !settings.autoCameraMovement;

  // The still path opens *on* the route rather than easing into it. Setting
  // the phase from an effect instead would render one frame of the departing
  // seat first -- a flash of the exact camera move the setting asks not to
  // happen.
  const [phase, setPhase] = useState<TravelPhase>(still ? "route" : "seat");

  const fromIndex = Math.max(
    0,
    route.findIndex((stop) => stop.id === fromEventId),
  );
  const toIndex = Math.max(
    0,
    route.findIndex((stop) => stop.id === toEventId),
  );
  const from = route[fromIndex];
  const to = route[toIndex];

  useEffect(() => {
    // Same freeze discipline as the arrival fly-through: if the window goes
    // away mid-journey the remaining delays are frozen and resumed from their
    // remainder, so the player never returns to find themselves already seated
    // at an event they never watched themselves reach.
    const delays: FreezableDelay[] = [];
    const schedule = (ms: number, callback: () => void) => {
      const delay = new FreezableDelay(realFreezableDelayHost, ms, callback);
      freezeGroup.add(delay);
      delays.push(delay);
    };

    if (still) {
      // The static alternative is not "no screen" -- the route still has to be
      // shown, or the step the player just earned is recorded while nobody is
      // looking at it. It is shown at rest, held long enough to read, and then
      // handed on.
      schedule(900, onComplete);
    } else if (settings.roomMotion === "reduced") {
      schedule(260, () => setPhase("rise"));
      schedule(700, () => setPhase("route"));
      schedule(1_500, () => setPhase("approach"));
      schedule(2_100, onComplete);
    } else {
      schedule(700, () => setPhase("rise"));
      schedule(1_900, () => setPhase("route"));
      schedule(4_100, () => setPhase("approach"));
      schedule(5_400, onComplete);
    }

    return () => {
      for (const delay of delays) {
        delay.cancel();
        freezeGroup.remove(delay);
      }
    };
  }, [
    freezeGroup,
    onComplete,
    still,
    settings.roomMotion,
  ]);

  const status =
    phase === "seat"
      ? formatMessage("travel.status.leavingSeat")
      : phase === "rise"
        ? formatMessage("travel.status.aboveRoom")
        : phase === "route"
          ? formatMessage("travel.status.route")
          : formatMessage("travel.status.approaching", { eventName: to.name });

  return (
    <main
      className={`career-travel career-travel--${phase}`}
      data-from-tier={from.tier}
      data-to-tier={to.tier}
      aria-labelledby="career-travel-title"
      {...localeTextAttributes()}
    >
      {/*
        The whole journey in one sentence, announced once. The visual sequence
        is decorative; a screen reader user gets the same information without
        having to wait out five seconds of camera movement.
      */}
      <p className="visually-hidden" role="status">
        {formatMessage("travel.announce", {
          fromEvent: from.name,
          toEvent: to.name,
          toIndex: toIndex + 1,
          total: route.length,
        })}
      </p>

      {/*
        Departure and approach share one venue, re-dressed by tier. The seat
        recedes as the camera rises; the destination room grows in behind the
        route. Decorative throughout -- no career state is conveyed here that
        is not also in the text below.
      */}
      <div className="career-travel__venue" aria-hidden="true">
        <div className="career-travel__floor" />
        <div className="career-travel__seat" />
        <div className="career-travel__destination">
          {Array.from({ length: 5 }).map((_, index) => (
            <span
              key={index}
              style={
                { "--travel-depth": ((index + 1) / 5).toFixed(2) } as CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <header className="career-travel__hud">
        <p className="eyebrow">
          {formatMessage("travel.from", { eventName: from.name })}
        </p>
        <h1 id="career-travel-title">
          {formatMessage("travel.heading", { eventName: to.name })}
        </h1>
        <span className="career-travel__status" aria-hidden="true">
          {status}
        </span>
      </header>

      {/*
        The circuit route, with the marker's start and end pinned as custom
        properties. The marker transitions between them when the `route` phase
        class lands, so the movement is the same left-to-right progression the
        lobby shows statically -- the player watches the step they just earned
        being taken.
      */}
      <ol
        className="career-travel__route"
        aria-label={formatMessage("travel.routeAriaLabel", {
          fromEvent: from.name,
          toEvent: to.name,
        })}
        style={
          {
            "--travel-from": `${slotPercent(fromIndex, route.length)}%`,
            "--travel-to": `${slotPercent(toIndex, route.length)}%`,
          } as CSSProperties
        }
      >
        <i className="career-travel__marker" aria-hidden="true" />
        {route.map((stop, index) => (
          <li
            key={stop.id}
            data-stop-state={
              index === toIndex
                ? "destination"
                : index === fromIndex
                  ? "origin"
                  : stop.cleared
                    ? "cleared"
                    : "ahead"
            }
          >
            <span>{stop.name}</span>
          </li>
        ))}
      </ol>

      <button className="career-travel__skip" type="button" onClick={onComplete}>
        {phase === "approach" ? (
          <>
            {formatMessage("travel.button.arrive", { eventName: to.name })}{" "}
            <ArrowRight size={17} />
          </>
        ) : (
          <>
            {formatMessage("travel.button.skip")} <FastForward size={17} />
          </>
        )}
      </button>
    </main>
  );
}

export default CareerTravel;
