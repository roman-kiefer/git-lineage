// Window "message" events that come from the host.
// - Browser pane (local server): standaloneBridge.ts turns the server's events into synthetic
//   message events, which have no source window. Another page holding a reference to this
//   window (an opener, say) could post messages as well, for example a forged form; those have
//   a source and are ignored.
// - VS Code: the webview is isolated by VS Code, every message comes from the extension.
export const isHostMessage = (event: MessageEvent): boolean =>
  !(window as { gitLineageStandalone?: boolean }).gitLineageStandalone || event.source === null;

// Listen to host messages only.
export const onHostMessage = (listener: (data: unknown) => void): void => {
  window.addEventListener('message', (event) => {
    if (isHostMessage(event)) {
      listener(event.data);
    }
  });
};
