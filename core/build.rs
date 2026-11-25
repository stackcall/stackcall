use tauri_winres::{VersionInfo, WindowsResource};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../app/src-tauri/tauri.conf.json");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let config: serde_json::Value =
        serde_json::from_str(include_str!("../app/src-tauri/tauri.conf.json"))
            .expect("invalid Tauri configuration");
    let name = config["productName"]
        .as_str()
        .expect("missing product name");
    let version = config["version"].as_str().expect("missing product version");
    let parsed = semver::Version::parse(version).expect("invalid product version");
    let numeric_version = (parsed.major << 48) | (parsed.minor << 32) | (parsed.patch << 16);

    WindowsResource::new()
        .set("ProductName", name)
        .set("ProductVersion", version)
        .set("FileDescription", "Stackcall Core")
        .set("FileVersion", version)
        .set_version_info(VersionInfo::PRODUCTVERSION, numeric_version)
        .set_version_info(VersionInfo::FILEVERSION, numeric_version)
        .compile()
        .expect("could not embed Windows version metadata");
}
