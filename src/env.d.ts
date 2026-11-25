// What a bundler tells the page: Vite sets `import.meta.env.DEV` while serving in development and
// `PROD` in a production build. Run with neither — Node, a test — both are unset.
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean; readonly PROD?: boolean };
}
