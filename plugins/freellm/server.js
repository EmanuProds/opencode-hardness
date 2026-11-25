// Root entrypoint for OpenCode host plugin loading.
//
// OpenCode resolves a local plugin directory by probing the subpaths
// `server.*` / `index.*` at the package root — it never reads package.json
// `main`/`exports`. This stable re-export keeps the package root resolvable.
export { default } from "./freellm.ts";
