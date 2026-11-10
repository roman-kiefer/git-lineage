// @vitest-environment happy-dom
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileViewer } from '../webview/src/graph/fileViewer';
import { MAX_VIEW_BYTES, StandaloneHost, readWorkingTreeFile } from '../src/standalone/standaloneHost';

const view = (): HTMLElement | null => document.querySelector('.file-view');
const texts = (selector: string): string[] =>
  Array.from(document.querySelectorAll(selector)).map((node) => node.textContent ?? '');

afterEach(() => {
  document.body.replaceChildren();
});

describe('file viewer (browser pane)', () => {
  it('diff: changed lines with context, a gap that opens on click, counts in the header', () => {
    const viewer = createFileViewer();
    const old = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
    const handled = viewer.handle({
      type: 'showFileView',
      payload: {
        mode: 'diff',
        path: 'a.txt',
        title: 'a.txt (abc1234)',
        left: { label: 'abc1234~1', text: old },
        right: { label: 'abc1234', text: old.replace('line 10', '<b>ten</b>') },
      },
    });
    expect(handled).toBe(true);
    expect(view()?.querySelector('.file-view__title')?.textContent).toBe('a.txt (abc1234)');
    expect(texts('.file-view__summary span')).toEqual(['+1', '−1']);
    // Text is shown as text, never as HTML.
    expect(texts('.file-view__line--add .file-view__text')).toEqual(['<b>ten</b>']);
    expect(document.querySelector('b')).toBeNull();
    const gap = document.querySelector<HTMLButtonElement>('.file-view__gap')!;
    expect(gap.textContent).toBe('⋯ 6 unchanged lines');
    gap.click();
    expect(document.querySelector('.file-view__gap')).toBeNull();
    expect(texts('.file-view__line--same .file-view__text')[0]).toBe('line 1');
  });

  it('file: every line with its number; Esc closes and other messages are ignored', () => {
    const viewer = createFileViewer();
    expect(viewer.handle({ type: 'status', payload: {} })).toBe(false);
    viewer.handle({ type: 'showFileView', payload: { mode: 'file', path: 'a.txt', title: 'a.txt', right: { label: 'Working Tree', text: 'x\ny\n' } } });
    expect(texts('.file-view__line--file .file-view__text')).toEqual(['x', 'y']);
    document.querySelector('.file-view__body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view()).toBeNull();
  });

  it('a notice replaces the content', () => {
    createFileViewer().handle({ type: 'showFileView', payload: { mode: 'diff', path: 'a.bin', title: 'a.bin', left: { label: 'x', text: '' }, right: { label: 'y', text: '' }, notice: 'Binary file, not shown.' } });
    expect(texts('.file-view__notice')).toEqual(['Binary file, not shown.']);
  });
});

describe('StandaloneHost Diff and Open', () => {
  const capture = (host: StandaloneHost): Array<{ type: string; payload: Record<string, unknown> }> => {
    const posted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    host.post = async (message) => {
      posted.push(message as { type: string; payload: Record<string, unknown> });
    };
    return posted;
  };

  it('diff of a commit reads both refs; the uncommitted diff reads the file on disk', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-view-'));
    fs.writeFileSync(path.join(repo, 'a.txt'), 'disk\n');
    const host = new StandaloneHost(undefined, async (_root, ref) => `at ${ref}\n`);
    const posted = capture(host);
    const hash = 'a'.repeat(40);
    await host.openDiff(repo, 'a.txt', `${hash}~1`, hash, 'a.txt (aaaaaaa)');
    expect(posted[0]).toEqual({
      type: 'showFileView',
      payload: {
        mode: 'diff',
        path: 'a.txt',
        title: 'a.txt (aaaaaaa)',
        left: { label: 'aaaaaaa~1', text: `at ${hash}~1\n` },
        right: { label: 'aaaaaaa', text: `at ${hash}\n` },
      },
    });
    await host.openDiff(repo, 'a.txt', 'HEAD', undefined, 'a.txt (Working Tree)');
    expect(posted[1].payload.right).toEqual({ label: 'Working Tree', text: 'disk\n' });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('binary and too large files are not sent', async () => {
    const host = new StandaloneHost(undefined, async (_root, ref) => (ref === 'big' ? 'x'.repeat(MAX_VIEW_BYTES + 1) : 'a\u0000b'));
    const posted = capture(host);
    await host.openFile('/repo', 'a.bin', 'bin');
    await host.openFile('/repo', 'big.txt', 'big');
    expect(posted.map((message) => message.payload.notice)).toEqual([
      'Binary file, not shown.',
      'The file is larger than 2 MB and is not shown here.',
    ]);
    expect(posted.every((message) => (message.payload.right as { text: string }).text === '')).toBe(true);
  });

  it('working tree files only inside the repository', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ggn-view-'));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
    fs.writeFileSync(path.join(repo, 'ok.txt'), 'ok');
    expect(await readWorkingTreeFile(repo, 'ok.txt')).toBe('ok');
    expect(await readWorkingTreeFile(repo, '../secret.txt')).toBe('');
    expect(await readWorkingTreeFile(repo, path.join(root, 'secret.txt'))).toBe('');
    expect(await readWorkingTreeFile(repo, 'missing.txt')).toBe('');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
