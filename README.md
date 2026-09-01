# Copilot Session Annotator

A browser-based interface for importing Copilot session Markdown, coding events,
and exporting annotations as JSON.

## Data privacy

The deployed application is static and has no backend. Imported session files are
read in the user's browser and are not uploaded to GitHub or another server.
Annotations and custom categories are stored in that browser's local storage until
the user exports or clears them.

## GitHub Pages

Pushing to `main` runs `.github/workflows/deploy-pages.yml`. The workflow builds
the app and deploys only the generated static `dist` directory to GitHub Pages.

In the GitHub repository, open **Settings > Pages** and set **Source** to
**GitHub Actions**. After the deployment succeeds, the app is available at:

<https://mooniem.github.io/copilot-session-annotation-interface/>

## Development

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Export session turns

Session analysis code lives in [`analysis/`](analysis/README.md).

Export one Copilot CLI session Markdown file:

```sh
npm run export-turns -- copilot-session-example.md
```

Pass a directory to recursively export every session Markdown file it contains:

```sh
npm run export-turns -- path/to/sessions
```

Multiple files or directories can be passed at once. Each session is written beside its
source file as `<source-name>-turns.csv` with the columns `#turn`, `#time`, `#duration`,
`#user or copilot`, and `#message`. Duration is the elapsed time until the next User or
Copilot message; it is blank for the final message. Reasoning, tool, and Info blocks are
excluded.
