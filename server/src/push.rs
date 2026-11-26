//! Web Push to the web app on phones (RFC 8030 delivery, RFC 8291 encryption, RFC 8292 VAPID).
//! The server keeps one VAPID key in `config`; each browser registers its own subscription.
use crate::{
    Config,
    auth::{self, User},
    db,
};
use aes_gcm::{Aes128Gcm, KeyInit, aead::Aead};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hkdf::Hkdf;
use p256::{
    PublicKey, SecretKey,
    ecdsa::{Signature, SigningKey, signature::Signer},
    elliptic_curve::sec1::ToEncodedPoint,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use std::{sync::Arc, time::Duration};

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/push/chave", get(public_key))
        .route("/api/push", post(subscribe).delete(unsubscribe))
}

/// Push services of the browsers that support Web Push. The server only posts to these hosts,
/// so a subscription cannot point it at an internal address.
const PUSH_HOSTS: [&str; 5] = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    ".push.apple.com",
    ".notify.windows.com",
    "push.services.mozilla.com",
];

fn allowed_endpoint(endpoint: &str) -> bool {
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    url.scheme() == "https"
        && url.port().is_none()
        && endpoint.len() <= 1024
        && PUSH_HOSTS.iter().any(|allowed| {
            host == allowed.trim_start_matches('.')
                || (allowed.starts_with('.') && host.ends_with(allowed))
        })
}

fn vapid_key(conn: &Connection) -> rusqlite::Result<SecretKey> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT valor FROM config WHERE chave = 'vapid_privada'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(key) = stored
        .and_then(|hex| B64.decode(hex).ok())
        .and_then(|bytes| SecretKey::from_slice(&bytes).ok())
    {
        return Ok(key);
    }
    let key = new_secret();
    conn.execute(
        "INSERT OR REPLACE INTO config (chave, valor) VALUES ('vapid_privada', ?1)",
        [B64.encode(key.to_bytes())],
    )?;
    Ok(key)
}

fn new_secret() -> SecretKey {
    loop {
        if let Ok(key) = SecretKey::from_slice(&rand::random::<[u8; 32]>()) {
            return key;
        }
    }
}

fn uncompressed(key: &PublicKey) -> Vec<u8> {
    key.to_encoded_point(false).as_bytes().to_vec()
}

async fn public_key(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Value>, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let key = vapid_key(conn).map_err(db::internal)?;
        Ok(Json(
            json!({ "chave": B64.encode(uncompressed(&key.public_key())) }),
        ))
    })
    .await
}

#[derive(Deserialize)]
struct Subscription {
    endpoint: String,
    #[serde(default)]
    p256dh: String,
    #[serde(default)]
    auth: String,
}

async fn subscribe(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<Subscription>,
) -> Result<StatusCode, StatusCode> {
    let valid_key = B64
        .decode(&input.p256dh)
        .ok()
        .is_some_and(|key| PublicKey::from_sec1_bytes(&key).is_ok());
    let valid_auth = B64.decode(&input.auth).ok().is_some_and(|a| a.len() == 16);
    if !allowed_endpoint(&input.endpoint) || !valid_key || !valid_auth {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM push_inscricoes WHERE usuario_id = ?1 AND endpoint <> ?2",
                params![user.id, input.endpoint],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if count >= 5 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        conn.execute(
            "INSERT INTO push_inscricoes (id, usuario_id, endpoint, p256dh, auth, criado_em)
             VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
             ON CONFLICT (endpoint) DO UPDATE SET usuario_id = ?2, p256dh = ?4, auth = ?5",
            params![
                auth::id(),
                user.id,
                input.endpoint,
                input.p256dh,
                input.auth
            ],
        )
        .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn unsubscribe(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<Subscription>,
) -> Result<StatusCode, StatusCode> {
    db::run(config, move |conn| {
        conn.execute(
            "DELETE FROM push_inscricoes WHERE usuario_id = ?1 AND endpoint = ?2",
            params![user.id, input.endpoint],
        )
        .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

struct Target {
    endpoint: String,
    p256dh: Vec<u8>,
    auth: Vec<u8>,
}

/// RFC 8291 aes128gcm body for one subscription (single record).
fn encrypt(payload: &[u8], ua_public: &[u8], auth_secret: &[u8]) -> Option<Vec<u8>> {
    encrypt_with(
        payload,
        ua_public,
        auth_secret,
        &new_secret(),
        &rand::random(),
    )
}

fn encrypt_with(
    payload: &[u8],
    ua_public: &[u8],
    auth_secret: &[u8],
    as_secret: &SecretKey,
    salt: &[u8; 16],
) -> Option<Vec<u8>> {
    let ua_key = PublicKey::from_sec1_bytes(ua_public).ok()?;
    let as_public = uncompressed(&as_secret.public_key());
    let shared = p256::ecdh::diffie_hellman(as_secret.to_nonzero_scalar(), ua_key.as_affine());
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(&as_public);
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth_secret), shared.raw_secret_bytes())
        .expand(&key_info, &mut ikm)
        .ok()?;
    let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .ok()?;
    prk.expand(b"Content-Encoding: nonce\0", &mut nonce).ok()?;
    let mut plain = payload.to_vec();
    plain.push(2); // last record, no padding
    let cipher = Aes128Gcm::new_from_slice(&cek)
        .ok()?
        .encrypt((&nonce).into(), plain.as_slice())
        .ok()?;
    let mut body = salt.to_vec();
    body.extend_from_slice(&4096u32.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(&as_public);
    body.extend_from_slice(&cipher);
    Some(body)
}

/// RFC 8292: a JWT signed with the server key, for the push service of `endpoint`.
fn vapid_header(key: &SecretKey, endpoint: &str, subject: &str) -> Option<String> {
    let url = url::Url::parse(endpoint).ok()?;
    let audience = url.origin().ascii_serialization();
    let expires = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs()
        + 12 * 3600;
    let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims = B64.encode(json!({ "aud": audience, "exp": expires, "sub": subject }).to_string());
    let unsigned = format!("{header}.{claims}");
    let signature: Signature = SigningKey::from(key).sign(unsigned.as_bytes());
    let public = B64.encode(uncompressed(&key.public_key()));
    Some(format!(
        "vapid t={unsigned}.{}, k={public}",
        B64.encode(signature.to_bytes())
    ))
}

/// Sends `message` to every phone of these people that turned the notices on. Runs in the
/// background: a slow push service never delays the request that triggered it.
pub fn notify(config: Arc<Config>, users: Vec<String>, message: Value) {
    if users.is_empty() {
        return;
    }
    tokio::spawn(async move {
        let subject = config.public_url.origin().ascii_serialization();
        let loaded = db::run(config.clone(), move |conn| {
            let key = vapid_key(conn).map_err(db::internal)?;
            let mut query = conn
                .prepare("SELECT endpoint, p256dh, auth FROM push_inscricoes WHERE usuario_id = ?1")
                .map_err(db::internal)?;
            let mut targets = Vec::new();
            for user in &users {
                let rows = query
                    .query_map([user], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(db::internal)?;
                for (endpoint, p256dh, auth) in rows.flatten() {
                    if let (Ok(p256dh), Ok(auth)) = (B64.decode(p256dh), B64.decode(auth)) {
                        targets.push(Target {
                            endpoint,
                            p256dh,
                            auth,
                        });
                    }
                }
            }
            Ok((key, targets))
        })
        .await;
        let Ok((key, targets)) = loaded else { return };
        let Ok(client) = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
        else {
            return;
        };
        let payload = message.to_string();
        let mut gone = Vec::new();
        for target in targets {
            if !allowed_endpoint(&target.endpoint) {
                continue;
            }
            let (Some(body), Some(vapid)) = (
                encrypt(payload.as_bytes(), &target.p256dh, &target.auth),
                vapid_header(&key, &target.endpoint, &subject),
            ) else {
                continue;
            };
            let response = client
                .post(&target.endpoint)
                .header("TTL", "3600")
                .header("Urgency", "high")
                .header("Content-Encoding", "aes128gcm")
                .header("Content-Type", "application/octet-stream")
                .header("Authorization", vapid)
                .body(body)
                .send()
                .await;
            if let Ok(response) = response
                && matches!(response.status().as_u16(), 404 | 410)
            {
                gone.push(target.endpoint);
            }
        }
        if !gone.is_empty() {
            let _ = db::run(config, move |conn| {
                for endpoint in gone {
                    conn.execute(
                        "DELETE FROM push_inscricoes WHERE endpoint = ?1",
                        [endpoint],
                    )
                    .map_err(db::internal)?;
                }
                Ok(())
            })
            .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decrypts as the browser would (RFC 8291 section 3.4) and checks the round trip.
    #[test]
    fn encrypts_a_payload_the_browser_can_read() {
        let ua_secret = new_secret();
        let ua_public = uncompressed(&ua_secret.public_key());
        let auth_secret = [7u8; 16];
        let body = encrypt(b"{\"titulo\":\"Bora?\"}", &ua_public, &auth_secret).unwrap();
        let (salt, rest) = body.split_at(16);
        assert_eq!(&rest[..4], &4096u32.to_be_bytes());
        let id_len = rest[4] as usize;
        let as_public = &rest[5..5 + id_len];
        let cipher = &rest[5 + id_len..];
        let as_key = PublicKey::from_sec1_bytes(as_public).unwrap();
        let shared = p256::ecdh::diffie_hellman(ua_secret.to_nonzero_scalar(), as_key.as_affine());
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(&ua_public);
        info.extend_from_slice(as_public);
        let mut ikm = [0u8; 32];
        Hkdf::<Sha256>::new(Some(&auth_secret), shared.raw_secret_bytes())
            .expand(&info, &mut ikm)
            .unwrap();
        let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
        let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
        prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
            .unwrap();
        prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
            .unwrap();
        let plain = Aes128Gcm::new_from_slice(&cek)
            .unwrap()
            .decrypt((&nonce).into(), cipher)
            .unwrap();
        assert_eq!(plain, b"{\"titulo\":\"Bora?\"}\x02");
    }

    #[test]
    fn only_posts_to_known_push_services() {
        assert!(allowed_endpoint("https://fcm.googleapis.com/fcm/send/abc"));
        assert!(allowed_endpoint("https://web.push.apple.com/QGt"));
        assert!(allowed_endpoint(
            "https://updates.push.services.mozilla.com/wpush/v2/x"
        ));
        assert!(!allowed_endpoint("http://fcm.googleapis.com/fcm/send/abc"));
        assert!(!allowed_endpoint("https://127.0.0.1:7880/x"));
        assert!(!allowed_endpoint(
            "https://evilpush.apple.com.attacker.test/x"
        ));
        assert!(!allowed_endpoint("https://fcm.googleapis.com:8443/x"));
    }

    #[test]
    fn signs_a_vapid_token_for_the_push_origin() {
        let key = new_secret();
        let header = vapid_header(
            &key,
            "https://fcm.googleapis.com/fcm/send/abc",
            "https://galera.test",
        )
        .unwrap();
        let token = header
            .strip_prefix("vapid t=")
            .unwrap()
            .split(", k=")
            .next()
            .unwrap();
        let claims: Value =
            serde_json::from_slice(&B64.decode(token.split('.').nth(1).unwrap()).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        let (unsigned, signature) = token.rsplit_once('.').unwrap();
        use p256::ecdsa::{VerifyingKey, signature::Verifier};
        let signature = Signature::from_slice(&B64.decode(signature).unwrap()).unwrap();
        assert!(
            VerifyingKey::from(&key.public_key())
                .verify(unsigned.as_bytes(), &signature)
                .is_ok()
        );
    }
}
