import { describe, expect, it } from "vitest";
import { tournamentResultAudioCue } from "./tournamentResultAudio";

describe("tournament ceremony audio", () => {
  it("uses only public placement and qualification", () => {
    expect(tournamentResultAudioCue({ finishPlace: 1, qualified: true })).toBe("win");
    expect(tournamentResultAudioCue({ finishPlace: 4, qualified: true })).toBe("win");
    expect(tournamentResultAudioCue({ finishPlace: 6, qualified: false })).toBe("eliminated");
  });
});
