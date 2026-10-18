// Opening a web link in the player's own browser. The desktop webview drops `target="_blank"` and `window.open`, so the
// page asks the shell. The page is not trusted to choose any address: only Songsterr's own site is allowed.

const ALLOWED_PREFIX: &str = "https://www.songsterr.com/";

fn allowed(url: &str) -> bool {
    url.starts_with(ALLOWED_PREFIX) && url.len() <= 2048 && url.chars().all(|c| c.is_ascii() && !c.is_ascii_control() && c != ' ' && c != '"')
}

/// Opens a Songsterr page in the default browser. Any other address is refused.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !allowed(&url) {
        return Err("that address cannot be opened from here".to_string());
    }
    // rundll32 takes the address as one argument and never passes it through a shell, so `&` and `%` in a search stay literal.
    std::process::Command::new("rundll32").arg("url.dll,FileProtocolHandler").arg(&url).spawn().map(|_| ()).map_err(|e| format!("could not open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_songsterr_search_pages() {
        assert!(allowed("https://www.songsterr.com/"));
        assert!(allowed("https://www.songsterr.com/?pattern=AC%2FDC%20%26%20friends%3F"));
    }

    #[test]
    fn refuses_other_hosts_schemes_and_tricks() {
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://www.songsterr.com/"));
        assert!(!allowed("https://www.songsterr.com.evil.test/"));
        assert!(!allowed("https://www.songsterr.com@evil.test/"));
        assert!(!allowed("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed("https://www.songsterr.com/ --flag"));
        assert!(!allowed("https://www.songsterr.com/\r\nx"));
        assert!(!allowed(""));
    }
}
