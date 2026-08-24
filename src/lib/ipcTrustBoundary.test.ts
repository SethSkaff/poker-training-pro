import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertTrustedSender } = require("../../electron/ipc-trust.cjs") as {
  assertTrustedSender(
    event: { sender?: object; senderFrame?: object },
    options: { mainWebContents?: object; isTrustedUrl: (url: string) => boolean },
  ): void;
};

describe("privileged IPC sender boundary", () => {
  const frame = { url: "poker-training-pro://app/index.html" };
  const mainWebContents = { mainFrame: frame };
  const trusted = { sender: mainWebContents, senderFrame: frame };
  const isTrustedUrl = (url: string) => url === frame.url;

  it("accepts only the live window main frame", () => {
    expect(() =>
      assertTrustedSender(trusted, { mainWebContents, isTrustedUrl }),
    ).not.toThrow();
  });

  it.each([
    ["missing sender frame", { sender: mainWebContents }],
    ["child frame", { sender: mainWebContents, senderFrame: { url: frame.url } }],
    ["second web contents", { sender: { mainFrame: frame }, senderFrame: frame }],
    ["untrusted URL", { sender: mainWebContents, senderFrame: { url: "https://evil.test/" } }],
  ])("rejects %s", (_label, event) => {
    expect(() => assertTrustedSender(event, { mainWebContents, isTrustedUrl })).toThrow(
      /untrusted renderer/,
    );
  });
});
