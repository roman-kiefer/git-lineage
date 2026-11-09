// Forms shown inside the webview (same look in VS Code and in the browser pane).
// The controller sends "showForm", the webview answers "formSubmit" / "formCancel";
// on a problem the controller sends "formError" (form stays open), otherwise "formClose".
// Mirrored in webview/src/graph/formDialog.ts.

// Field shown only while another field has a given value (e.g. message only for annotated tags).
export type FormCondition = { field: string; value: string | boolean };

type FieldBase = {
  id: string;
  label: string;
  // Explanation behind an (i) symbol next to the field.
  info?: string;
  showWhen?: FormCondition;
};

export type FormField =
  | (FieldBase & { kind: 'text'; value?: string; placeholder?: string; required?: boolean })
  | (FieldBase & { kind: 'select'; value?: string; options: Array<{ value: string; label: string }> })
  | (FieldBase & { kind: 'checkbox'; value?: boolean });

export type FormSpec = {
  title: string;
  // Second line under the title (e.g. a warning).
  detail?: string;
  fields: FormField[];
  submitLabel: string;
};

// Values of the visible fields by id (text/select: string, checkbox: boolean).
export type FormValues = Record<string, string | boolean>;

// Problem with the entered values: shown at the field (or above the buttons without field).
export type FormProblem = { field?: string; message: string };

// Read values sent by the webview defensively (they are data from the page, not trusted types).
export const formText = (values: FormValues, id: string): string => {
  const value = values[id];
  return typeof value === 'string' ? value : '';
};

export const formFlag = (values: FormValues, id: string): boolean => values[id] === true;
