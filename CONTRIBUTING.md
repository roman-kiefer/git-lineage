# Contributing to Git Lineage

Thanks for wanting to help. Bug reports, ideas and pull requests are welcome.
By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and asking for features

Open a [GitHub issue](https://github.com/roman-kiefer/git-lineage/issues/new/choose) and pick the matching form. For bugs, the most useful details are:

- where you use Git Lineage (VS Code or Claude Code) and its version,
- your operating system and `git --version`,
- what you did, what you expected, and what happened instead,
- a screenshot, and the exact text of any error message.

Security problems do **not** belong in a public issue; see the [security policy](SECURITY.md).

## Before you start on a pull request

For anything larger than a small fix, please open an issue first and describe what you want to change. That avoids work on something that does not fit the project.

## Clean-room rule

Git Lineage is developed independently. **Do not copy code, styles, icons, texts or other assets from other Git graph extensions** (or any project whose license does not allow it), not even small parts. If a behavior from another tool is a good idea, describe it in your own words and implement it from scratch. Pull requests that contain copied material will be closed.

## Setting up

Requirements: Node.js 22 (CI uses 22; the Claude Code plugin itself runs on Node.js 18 or later) and Git.

```
npm ci
npm run check      # type checks of extension, webview and tests, then the test suite
```

Useful while working:

| Command | What it does |
|---|---|
| `npm run watch` | Recompiles the extension on change |
| `npm run esbuild:watch` | Rebuilds the webview bundle on change |
| `npm run test:watch` | Runs the tests on change |
| `npm run standalone` | Starts the local server used by the Claude Code plugin, for testing in a browser |
| `npm run plugin` | Rebuilds the plugin's server in `claude-plugin/server` |
| `npm run package` | Builds `git-lineage-<version>.vsix` |

To try the extension in VS Code, open the folder and start the *Run Extension* launch configuration (F5).

## Guidelines for changes

- Keep pull requests focused on one topic.
- Add or update tests in `test/` for changed behavior. Graph layout tests use recorded `git log` output in `test/fixtures/`; `npm run fixtures` regenerates it from synthetic repositories.
- `npm run check` must pass. CI runs it on Linux and Windows, so watch out for path separators and line endings.
- The project has no separate linter or formatter; follow the style of the surrounding code (4 spaces, TypeScript strict mode).
- Changes that are visible to users go into the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md), and into the README if they add or change a feature, setting or shortcut.
- The extension and the Claude Code plugin share one interface. If you change the webview, check both, or say in the pull request which one you could not test.
- No telemetry and no network access that the user did not trigger. New dependencies need a good reason; the extension has no runtime dependencies.
- Keep the interface usable with the keyboard alone; see [ACCESSIBILITY.md](ACCESSIBILITY.md).

## License

Git Lineage is licensed under [GPL-3.0-only](LICENSE). By submitting a pull request you agree that your contribution is published under the same license, and you confirm that you have the right to submit it.
