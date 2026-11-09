"use strict";
(() => {
  // webview/src/standaloneBridge.ts
  var sendToServer = (message) => {
    void fetch("/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      credentials: "same-origin"
    });
  };
  var answer = (id, value) => {
    sendToServer({ type: "hostResponse", payload: { id, value } });
  };
  var openDialog;
  var closeDialog = (id) => {
    if (openDialog && (id === void 0 || openDialog.id === id)) {
      openDialog.element.remove();
      openDialog = void 0;
    }
  };
  var showDialog = (request) => {
    closeDialog();
    const backdrop = document.createElement("div");
    backdrop.className = "host-dialog-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "host-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const title = document.createElement("div");
    title.className = "host-dialog__title";
    title.textContent = request.kind === "confirm" ? request.message : request.title;
    dialog.appendChild(title);
    const detailText = request.kind === "confirm" ? request.detail : request.prompt;
    if (detailText) {
      const detail = document.createElement("div");
      detail.className = "host-dialog__detail";
      detail.textContent = detailText;
      dialog.appendChild(detail);
    }
    let input;
    if (request.kind === "prompt") {
      input = document.createElement("input");
      input.className = "host-dialog__input";
      input.value = request.value ?? "";
      dialog.appendChild(input);
      if (request.error) {
        const error = document.createElement("div");
        error.className = "host-dialog__error";
        error.textContent = request.error;
        dialog.appendChild(error);
      }
    }
    const buttons = document.createElement("div");
    buttons.className = "host-dialog__buttons";
    const finish = (value) => {
      closeDialog(request.id);
      answer(request.id, value);
    };
    const labels = request.kind === "confirm" ? request.buttons : ["OK"];
    labels.forEach((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === 0 ? "host-dialog__button host-dialog__button--primary" : "host-dialog__button";
      button.textContent = label;
      button.addEventListener("click", () => finish(request.kind === "confirm" ? label : input?.value ?? ""));
      buttons.appendChild(button);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "host-dialog__button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => finish(void 0));
    buttons.appendChild(cancel);
    dialog.appendChild(buttons);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(void 0);
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        buttons.firstElementChild?.click();
      } else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && event.target instanceof HTMLButtonElement) {
        event.preventDefault();
        const all = Array.from(buttons.querySelectorAll("button"));
        const step = event.key === "ArrowRight" ? 1 : -1;
        all[(all.indexOf(event.target) + step + all.length) % all.length]?.focus();
      }
    });
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    openDialog = { id: request.id, element: backdrop };
    (input ?? buttons.firstElementChild)?.focus();
    input?.select();
  };
  var handleHostRequest = (request) => {
    if (request.kind === "copy") {
      navigator.clipboard.writeText(request.text).then(
        () => answer(request.id, "ok"),
        () => answer(request.id, void 0)
      );
      return;
    }
    showDialog(request);
  };
  var queue = [];
  var connected = false;
  var wasConnected = false;
  var reportDisconnected = () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "error",
          payload: { message: "Connection to the Git Graph server lost. Start it again (e.g. the preview), then reload this page." }
        }
      })
    );
  };
  var events = new EventSource("/events");
  events.onopen = () => {
    connected = true;
    wasConnected = true;
    queue.splice(0).forEach(sendToServer);
  };
  events.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hostRequest") {
      handleHostRequest(message.payload);
      return;
    }
    if (message.type === "hostRequestClosed") {
      closeDialog(message.payload.id);
      return;
    }
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  };
  events.onerror = () => {
    if (connected) {
      connected = false;
      events.addEventListener("open", () => sendToServer({ type: "ready" }), { once: true });
      reportDisconnected();
    }
  };
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => {
      if (connected) {
        sendToServer(message);
      } else {
        queue.push(message);
        if (wasConnected) {
          reportDisconnected();
        }
      }
    },
    getState: () => void 0,
    setState: () => void 0
  });
})();
//# sourceMappingURL=standaloneBridge.js.map
