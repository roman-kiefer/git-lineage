// Forms of the extension shown as a dialog in the webview (same look in VS Code and in the
// browser pane). Protocol (see src/core/forms.ts): "showForm" opens, the dialog answers with
// "formSubmit" / "formCancel"; "formError" shows a problem (dialog stays), "formClose" closes.

type FormCondition = { field: string; value: string | boolean };

type FieldBase = { id: string; label: string; info?: string; showWhen?: FormCondition };

export type FormField =
  | (FieldBase & { kind: 'text'; value?: string; placeholder?: string; required?: boolean })
  | (FieldBase & { kind: 'select'; value?: string; options: Array<{ value: string; label: string }> })
  | (FieldBase & { kind: 'checkbox'; value?: boolean });

export type FormRequest = {
  id: string;
  title: string;
  detail?: string;
  fields: FormField[];
  submitLabel: string;
};

export type FormValues = Record<string, string | boolean>;

type FormAnswers = {
  submit: (id: string, values: FormValues) => void;
  cancel: (id: string) => void;
};

type IncomingFormMessage = { type?: string; payload?: Record<string, unknown> };

// One open form: its elements and how to read the values.
type OpenDialog = {
  id: string;
  backdrop: HTMLElement;
  submit: HTMLButtonElement;
  setError: (field: string | undefined, message: string) => void;
  setBusy: (busy: boolean) => void;
};

// (i) button: tooltip on hover; a click (or Enter/Space) shows the explanation under the field.
const createInfo = (text: string, hint: HTMLElement): HTMLButtonElement => {
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'form-dialog__info';
  info.textContent = 'i';
  info.title = text;
  info.setAttribute('aria-label', `About this option: ${text}`);
  info.setAttribute('aria-expanded', 'false');
  hint.textContent = text;
  info.addEventListener('click', () => {
    hint.hidden = !hint.hidden;
    info.setAttribute('aria-expanded', String(!hint.hidden));
  });
  return info;
};

const createHint = (): HTMLElement => {
  const hint = document.createElement('div');
  hint.className = 'form-dialog__hint';
  hint.hidden = true;
  return hint;
};

export const createFormDialog = (answers: FormAnswers) => {
  let open: OpenDialog | undefined;
  // Element focused before the dialog opened (focus goes back there).
  let previousFocus: HTMLElement | null = null;

  const close = (): void => {
    open?.backdrop.remove();
    open = undefined;
    // Back to where the user was, without scrolling the list (the row may be out of view).
    // Was it a menu entry (gone by now), the list itself takes the focus for the arrow keys.
    const target = previousFocus?.isConnected && previousFocus !== document.body
      ? previousFocus
      : document.getElementById('commit-items');
    target?.focus({ preventScroll: true });
    previousFocus = null;
  };

  const show = (request: FormRequest): void => {
    close();
    previousFocus = document.activeElement as HTMLElement | null;

    const backdrop = document.createElement('div');
    backdrop.className = 'form-dialog-backdrop';
    const dialog = document.createElement('form');
    dialog.className = 'form-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.noValidate = true;

    const title = document.createElement('div');
    title.className = 'form-dialog__title';
    title.id = `${request.id}-title`;
    title.textContent = request.title;
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.appendChild(title);
    if (request.detail) {
      const detail = document.createElement('div');
      detail.className = 'form-dialog__detail';
      detail.textContent = request.detail;
      dialog.appendChild(detail);
    }

    const grid = document.createElement('div');
    grid.className = 'form-dialog__fields';
    dialog.appendChild(grid);

    // Controls by field id, rows (for showWhen) and per-field error lines.
    const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const rows: Array<{ field: FormField; elements: HTMLElement[] }> = [];
    const errors = new Map<string, HTMLElement>();

    request.fields.forEach((field) => {
      const controlId = `${request.id}-${field.id}`;
      const elements: HTMLElement[] = [];
      let control: HTMLInputElement | HTMLSelectElement;

      if (field.kind === 'checkbox') {
        // Checkbox: box and label together in the control column.
        const spacer = document.createElement('span');
        const wrap = document.createElement('label');
        wrap.className = 'form-dialog__check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = controlId;
        box.checked = field.value === true;
        wrap.append(box, document.createTextNode(field.label));
        const cell = document.createElement('div');
        cell.className = 'form-dialog__control form-dialog__control--check';
        cell.appendChild(wrap);
        const hint = createHint();
        if (field.info) {
          cell.appendChild(createInfo(field.info, hint));
        }
        elements.push(spacer, cell, hint);
        control = box;
      } else {
        const label = document.createElement('label');
        label.className = 'form-dialog__label';
        label.htmlFor = controlId;
        label.textContent = `${field.label}:`;
        const cell = document.createElement('div');
        cell.className = 'form-dialog__control';
        if (field.kind === 'select') {
          const select = document.createElement('select');
          select.className = 'form-dialog__input';
          field.options.forEach((option) => {
            const element = document.createElement('option');
            element.value = option.value;
            element.textContent = option.label;
            select.appendChild(element);
          });
          if (field.value !== undefined) {
            select.value = field.value;
          }
          control = select;
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'form-dialog__input';
          input.value = field.value ?? '';
          input.placeholder = field.placeholder ?? '';
          input.spellcheck = false;
          input.autocomplete = 'off';
          control = input;
        }
        control.id = controlId;
        cell.appendChild(control);
        const hint = createHint();
        if (field.info) {
          cell.appendChild(createInfo(field.info, hint));
        }
        elements.push(label, cell, hint);
      }

      const error = document.createElement('div');
      error.className = 'form-dialog__error';
      error.hidden = true;
      error.setAttribute('role', 'alert');
      elements.push(error);
      errors.set(field.id, error);

      elements.forEach((element) => grid.appendChild(element));
      controls.set(field.id, control);
      rows.push({ field, elements });
    });

    const generalError = document.createElement('div');
    generalError.className = 'form-dialog__error form-dialog__error--general';
    generalError.hidden = true;
    generalError.setAttribute('role', 'alert');
    dialog.appendChild(generalError);

    const buttons = document.createElement('div');
    buttons.className = 'form-dialog__buttons';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'form-dialog__button form-dialog__button--primary';
    submit.textContent = request.submitLabel;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'form-dialog__button';
    cancel.textContent = 'Cancel';
    buttons.append(submit, cancel);
    dialog.appendChild(buttons);

    const valueOf = (id: string): string | boolean | undefined => {
      const control = controls.get(id);
      if (!control) {
        return undefined;
      }
      return control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
    };
    const isShown = (field: FormField): boolean =>
      !field.showWhen || valueOf(field.showWhen.field) === field.showWhen.value;

    // Show/hide dependent fields; the submit button waits for required text fields.
    let busy = false;
    const update = (): void => {
      rows.forEach(({ field, elements }) => {
        const shown = isShown(field);
        elements.forEach((element) => {
          // Errors and opened hints keep their own state; a hidden field hides them too.
          const ownState = element.classList.contains('form-dialog__error') || element.classList.contains('form-dialog__hint');
          if (!ownState) {
            element.hidden = !shown;
          } else if (!shown) {
            element.hidden = true;
          }
        });
      });
      const missing = request.fields.some(
        (field) => field.kind === 'text' && field.required && isShown(field) && !String(valueOf(field.id) ?? '').trim(),
      );
      submit.disabled = busy || missing;
    };

    const clearErrors = (): void => {
      errors.forEach((error) => {
        error.hidden = true;
        error.textContent = '';
      });
      generalError.hidden = true;
    };

    controls.forEach((control) => {
      control.addEventListener('input', () => {
        clearErrors();
        update();
      });
      control.addEventListener('change', update);
    });

    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      update();
      if (submit.disabled) {
        return;
      }
      // Only visible fields count (e.g. no message for a lightweight tag).
      const values: FormValues = {};
      request.fields.filter(isShown).forEach((field) => {
        const value = valueOf(field.id);
        if (value !== undefined) {
          values[field.id] = value;
        }
      });
      open?.setBusy(true);
      answers.submit(request.id, values);
    });

    const doCancel = (): void => {
      close();
      answers.cancel(request.id);
    };
    cancel.addEventListener('click', doCancel);
    dialog.addEventListener('keydown', (event) => {
      // Keys stay in the dialog (the list below must not react to them).
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        doCancel();
      }
    });
    // Click on the dark area around the dialog cancels as well.
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) {
        doCancel();
      }
    });

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    open = {
      id: request.id,
      backdrop,
      submit,
      setError: (field, message) => {
        const target = (field && errors.get(field)) || generalError;
        target.textContent = message;
        target.hidden = false;
        const control = field ? controls.get(field) : undefined;
        control?.focus({ preventScroll: true });
      },
      setBusy: (value) => {
        busy = value;
        update();
      },
    };
    update();
    // Focus the first field.
    controls.values().next().value?.focus({ preventScroll: true });
  };

  // Returns true when the message belonged to the forms.
  const handle = (message: IncomingFormMessage): boolean => {
    const payload = message.payload ?? {};
    switch (message.type) {
      case 'showForm':
        show(payload as unknown as FormRequest);
        return true;
      case 'formError':
        if (open && open.id === payload.id) {
          open.setBusy(false);
          open.setError(payload.field as string | undefined, String(payload.message ?? ''));
        }
        return true;
      case 'formClose':
        if (open && open.id === payload.id) {
          close();
        }
        return true;
      default:
        return false;
    }
  };

  return { handle };
};
