# uitive

Uitive adapts an application's interface to each person, learned from use and redesigned by asking in plain language. This package is its command line, [`@plurid/uitive-cli`](https://github.com/plurid/uitive/blob/master/packages/cli/README.md), under its short name, so setting Uitive up is one line, in your application's package (at a monorepo's root, `npx uitive detect` says which):

```sh
npx uitive init
```

`init` installs the packages with your package manager and writes a Uitive folder with every page as the page it already is; it never replaces a file. It also configures the coding agents it finds, or Claude Code when it finds none, adding its MCP server to their configuration; `--no-agents` leaves them alone.

The other commands, from `detect` to `check`, are in [the CLI's README](https://github.com/plurid/uitive/blob/master/packages/cli/README.md), and a first integration in [Getting started](https://github.com/plurid/uitive/blob/master/docs/getting-started.md).
