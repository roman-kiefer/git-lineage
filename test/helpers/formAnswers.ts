import type { FormValues } from '../../src/core/forms';

type Message = { type: string; payload?: Record<string, unknown> };
type Receiver = { receive(message: never): Promise<void> };

// Answers the forms of the controller like a user in the webview: each "showForm" gets the
// next scripted values (undefined = Cancel). If the controller reports a problem ("formError"),
// the next values are submitted into the same form; with none left the form is cancelled.
export class FormAnswerer {
  answers: Array<FormValues | undefined> = [];
  // Forms shown and problems reported (for assertions).
  forms: Array<Record<string, unknown>> = [];
  errors: string[] = [];
  controller: Receiver | undefined;

  // Call from the test host's post().
  observe(message: Message): void {
    const id = message.payload?.id as string | undefined;
    if (message.type === 'showForm' && id) {
      this.forms.push(message.payload!);
      this.answer(id);
    } else if (message.type === 'formError' && id) {
      this.errors.push(String(message.payload!.message));
      this.answer(id);
    }
  }

  lastForm(): Record<string, unknown> | undefined {
    return this.forms.at(-1);
  }

  private answer(id: string): void {
    const values = this.answers.shift();
    // Answer after the controller has started waiting (like a real click later on).
    setTimeout(() => {
      const reply = values
        ? { type: 'formSubmit', payload: { id, values } }
        : { type: 'formCancel', payload: { id } };
      void this.controller?.receive(reply as never);
    }, 0);
  }
}
