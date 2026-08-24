/**
 * Validate that a privileged IPC request came from the one live application
 * window's main frame. Same-origin alone is not an identity check: another
 * WebContents or a child frame must not inherit the desktop bridge.
 */
function assertTrustedSender(event, options) {
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  const mainWebContents = options?.mainWebContents;
  const isTrustedUrl = options?.isTrustedUrl;
  if (
    !sender ||
    !senderFrame ||
    !mainWebContents ||
    sender !== mainWebContents ||
    senderFrame !== sender.mainFrame ||
    typeof isTrustedUrl !== "function" ||
    !isTrustedUrl(senderFrame.url)
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer");
  }
}

module.exports = { assertTrustedSender };
