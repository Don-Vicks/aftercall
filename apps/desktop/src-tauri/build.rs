use std::path::Path;
use std::process::Command;

/// The MCP server agents run ships inside the app as a bundle resource (tauri.conf.json),
/// and tauri-build refuses to compile when a resource is missing. On a fresh checkout
/// nothing has built it yet, so build it here. `tauri dev`, `tauri build` and the
/// desktop package's `build` script rebuild it every time.
fn main() {
    let bundle = Path::new("../../mcp/dist/aftercall-mcp.mjs");
    if !bundle.exists() {
        let built = Command::new("pnpm").args(["--filter", "@aftercall/mcp", "build"]).status();
        if !matches!(built, Ok(s) if s.success()) || !bundle.exists() {
            panic!("Couldn't build the MCP server (apps/mcp/dist/aftercall-mcp.mjs). Run `pnpm install`, then `pnpm --filter @aftercall/mcp build`.");
        }
    }
    println!("cargo:rerun-if-changed=../../mcp/dist/aftercall-mcp.mjs");
    tauri_build::build()
}
