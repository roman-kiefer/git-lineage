# Accessibility

Git Lineage should be usable by everyone who works with Git, including people who use only a keyboard, a screen reader, magnification or high-contrast themes. This page describes what works today, what does not yet, and how to report barriers.

## Supported environments

- **VS Code** 1.80 or later, as an editor tab. The view follows the active color theme, including the high-contrast themes.
- **Claude Code**, in the built-in browser pane, through the plugin's local server. The view follows the light or dark appearance of the pane.

## What works

- **Keyboard**: every action is reachable without a mouse. Focus the commit list with `g`, `Ctrl+G` or `Tab`, move with the arrow keys, `Home`/`End` and `PgUp`/`PgDn`, open details with `Enter`, open the context menu with the menu key or `Shift+F10`, search with `/` or `Ctrl+F`. The full list is in the [README](README.md#keyboard).
- **Interactive rebase**: commits can be reordered with `Alt+↑`/`Alt+↓` instead of dragging.
- **Forms and dialogs** for Git actions are labeled and modal; the search result count and the banner for stopped operations (merge, rebase, cherry-pick with conflicts) are announced to screen readers.
- **Reduced motion**: the refresh animation stops when the system asks for reduced motion.
- **Narrow windows and zoom**: less important columns are hidden before the commit description gets squeezed.

## Known limitations

- **The graph itself is visual only.** Lanes, curves and lane colors are drawn as an image and hidden from screen readers. Branch and tag names are available as text on the ref chips and in the hover and details, but the shape of the history (which commit belongs to which lane) is not announced.
- **Lane colors** are the only way to tell lanes apart in the graph. They are not tuned for color vision deficiencies yet.
- **Commit list and screen readers**: the list is focusable and works with the keyboard, but the selected row is not yet exposed to screen readers as the active item of a list. Open the details (`Enter`) to have the commit read out.
- **Column widths** can only be changed by dragging with a mouse or pen; the column separators receive keyboard focus but do not react to keys yet.
- Screen reader support has not been tested systematically with NVDA, JAWS or VoiceOver yet.

## Reporting a barrier

If something in Git Lineage is hard or impossible for you to use, please open a [GitHub issue](https://github.com/roman-kiefer/git-lineage/issues/new/choose) and say which assistive technology, operating system and host (VS Code or Claude Code) you use. Accessibility problems are treated as bugs.
