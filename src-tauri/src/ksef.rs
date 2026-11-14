//! KSeF dla okna aplikacji: token z pęku kluczy i żądania TYLKO DO ODCZYTU.
//!
//! Okno nie ma dostępu do sieci, więc każde żądanie do KSeF przechodzi tędy.
//! `is_read_only` powtarza listę z `lib/ksef-client.ts`: czego na niej nie ma,
//! tego aplikacja nie wyśle, nawet gdyby kod okna się pomylił. Adres jest
//! składany tutaj z nazwy środowiska, więc okno nie wskaże innego serwera.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const KEYCHAIN_SERVICE: &str = "nonoise-hub-ksef";

fn base_url(environment: &str) -> Option<&'static str> {
  match environment {
    "prod" => Some("https://api.ksef.mf.gov.pl/v2"),
    "test" => Some("https://api-test.ksef.mf.gov.pl/v2"),
    "demo" => Some("https://api-demo.ksef.mf.gov.pl/v2"),
    _ => None,
  }
}

fn is_identifier(value: &str) -> bool {
  !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Te same operacje co `READ_ONLY_ENDPOINTS` w `lib/ksef-client.ts`.
pub fn is_read_only(method: &str, path: &str) -> bool {
  let (pathname, query) = match path.split_once('?') {
    Some((pathname, query)) => (pathname, query),
    None => (path, ""),
  };
  if !query.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '=' | '&' | '_' | '-')) {
    return false;
  }
  match (method, pathname) {
    ("GET", "/security/public-key-certificates") => true,
    ("POST", "/auth/challenge")
    | ("POST", "/auth/ksef-token")
    | ("POST", "/auth/token/redeem")
    | ("POST", "/invoices/query/metadata") => true,
    ("GET", other) => {
      other.strip_prefix("/auth/").is_some_and(is_identifier)
        || other.strip_prefix("/invoices/ksef/").is_some_and(is_identifier)
    }
    _ => false,
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KsefRequest {
  environment: String,
  method: String,
  path: String,
  bearer: Option<String>,
  body: Option<String>,
  accept: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KsefResponse {
  status: u16,
  retry_after: Option<String>,
  body: String,
}

/// Token „Przeglądanie faktur" zapisany przez M.J. poleceniem `security add-generic-password`.
/// Czyta go systemowe `security`, które ten wpis utworzyło, więc macOS nie pyta o zgodę.
#[tauri::command(async)]
pub fn ksef_token(environment: String) -> Result<String, String> {
  if base_url(&environment).is_none() {
    return Err("unknown-environment".into());
  }
  let output = std::process::Command::new("/usr/bin/security")
    .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", &environment, "-w"])
    .output()
    .map_err(|_| "keychain-unavailable".to_string())?;
  let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if !output.status.success() || token.is_empty() {
    return Err("no-token".into());
  }
  Ok(token)
}

#[tauri::command]
pub async fn ksef_request(request: KsefRequest) -> Result<KsefResponse, String> {
  let base = base_url(&request.environment).ok_or("KSeF: nieznane środowisko")?;
  if !is_read_only(&request.method, &request.path) {
    return Err(format!(
      "KSeF: {} {} nie jest na liście operacji tylko do odczytu",
      request.method,
      request.path.split('?').next().unwrap_or("")
    ));
  }
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .build()
    .map_err(|error| format!("KSeF: {error}"))?;
  let url = format!("{base}{}", request.path);
  let mut call = if request.method == "POST" { client.post(&url) } else { client.get(&url) };
  call = call.header("Accept", request.accept.as_deref().unwrap_or("application/json"));
  if let Some(bearer) = &request.bearer {
    call = call.bearer_auth(bearer);
  }
  if let Some(body) = request.body {
    call = call.header("Content-Type", "application/json").body(body);
  }
  let response = call.send().await.map_err(|error| format!("KSeF: brak połączenia ({})", error.without_url()))?;
  let status = response.status().as_u16();
  let retry_after = response
    .headers()
    .get("Retry-After")
    .and_then(|value| value.to_str().ok())
    .map(str::to_string);
  let body = response.text().await.map_err(|error| format!("KSeF: {}", error.without_url()))?;
  Ok(KsefResponse { status, retry_after, body })
}

#[cfg(test)]
mod tests {
  use super::{is_read_only, ksef_request, ksef_token, KsefRequest};

  /// Próba z prawdziwą siecią i pękiem kluczy, tylko na żądanie: `cargo test --lib ksef -- --ignored`.
  /// Certyfikaty KSeF są publiczne, więc to nie zużywa limitów konta.
  #[test]
  #[ignore]
  fn laczy_sie_z_ksef_i_czyta_token() {
    let reply = tauri::async_runtime::block_on(ksef_request(KsefRequest {
      environment: "prod".into(),
      method: "GET".into(),
      path: "/security/public-key-certificates".into(),
      bearer: None,
      body: None,
      accept: None,
    }))
    .expect("KSeF odpowiada");
    assert_eq!(reply.status, 200);
    assert!(reply.body.contains("KsefTokenEncryption"));

    let refused = tauri::async_runtime::block_on(ksef_request(KsefRequest {
      environment: "prod".into(),
      method: "POST".into(),
      path: "/tokens".into(),
      bearer: None,
      body: None,
      accept: None,
    }));
    assert!(refused.is_err());

    assert!(ksef_token("prod".into()).is_ok_and(|token| token.len() > 20));
    assert!(ksef_token("gdzie-indziej".into()).is_err());
  }

  #[test]
  fn przepuszcza_tylko_odczyt() {
    assert!(is_read_only("GET", "/security/public-key-certificates"));
    assert!(is_read_only("POST", "/auth/challenge"));
    assert!(is_read_only("POST", "/auth/ksef-token"));
    assert!(is_read_only("GET", "/auth/20261114-AU-1234567890-ABCDEF-12"));
    assert!(is_read_only("POST", "/auth/token/redeem"));
    assert!(is_read_only("POST", "/invoices/query/metadata?pageOffset=0&pageSize=100&sortOrder=Asc"));
    assert!(is_read_only("GET", "/invoices/ksef/9591756851-20261101-0123456789AB-CD"));
  }

  #[test]
  fn odmawia_wysylania_faktur_i_reszty() {
    // Ścieżki wystawiania faktur składane z kawałków: test w lib/ksef-reconcile.test.ts
    // pilnuje, żeby żaden plik aplikacji nie zawierał ich w całości.
    for kind in ["online", "batch"] {
      assert!(!is_read_only("POST", &format!("/sessions/{kind}")));
    }
    assert!(!is_read_only("POST", "/tokens"));
    assert!(!is_read_only("POST", "/permissions/persons/grants"));
    assert!(!is_read_only("DELETE", "/auth/sessions/current"));
    assert!(!is_read_only("GET", "/auth/token/redeem"));
    assert!(!is_read_only("POST", "/invoices/ksef/abc"));
    assert!(!is_read_only("GET", "/invoices/ksef/../../tokens"));
    assert!(!is_read_only("GET", "/invoices/ksef/abc?x=/../y"));
    assert!(!is_read_only("GET", "//evil.example/auth/x"));
  }
}
