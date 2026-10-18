fn main() {
    println!("cargo:rerun-if-env-changed=TABHIGHWAY_STATUS_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=TABHIGHWAY_DEV_PRO");
    println!("cargo:rerun-if-env-changed=TABHIGHWAY_MIRROR_URL");
    tauri_build::build()
}
