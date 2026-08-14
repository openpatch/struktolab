# StruktoLab

A structogram (Nassi-Shneiderman diagram) editor and renderer, built as framework-free
Web Components. Edit a diagram visually or as pseudocode — the two stay in sync — and
generate Python, Java or JavaScript from it.

This repository is a pnpm workspace. Libraries live in `packages/`, the things we ship
to users live in `platforms/`.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/struktolab` | [`struktolab`](https://www.npmjs.com/package/struktolab) | The `<struktolab-editor>` and `<struktolab-renderer>` custom elements |
| `platforms/web` | private | The web app at [struktolab.openpatch.org](https://struktolab.openpatch.org) |
| `platforms/vscode` | private | **StruktoLab Studio**, the VS Code extension for `.struktolab` files |

## Getting started

```sh
pnpm install
pnpm build          # topological: the library builds before its consumers
```

`platforms/web` and `platforms/vscode` both consume the *built* library, so run
`pnpm build` once before working on either of them. After that, `pnpm dev` watches
everything in parallel.

```sh
pnpm --filter web dev                  # the web app on http://localhost:8080
pnpm --filter struktolab-studio watch  # rebuild the extension on change, then F5 in VS Code
```

## Releasing

Changesets drives the version bumps. Add one with `pnpm changeset`; merging the
resulting "Version Packages" pull request publishes `struktolab` to npm and pushes the
VS Code extension to both the Marketplace and Open VSX.

## License

MIT — see [license.md](./license.md).
