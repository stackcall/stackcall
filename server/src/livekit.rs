use axum::http::StatusCode;
use futures_util::{StreamExt, TryStreamExt, stream};
use livekit_api::access_token::{AccessToken, VideoGrants};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    time::Duration,
};
use url::Url;

const TOKEN_TTL: Duration = Duration::from_secs(3600);

pub struct LiveKit {
    key: String,
    secret: String,
    public_url: String,
    internal_url: Url,
    client: Client,
}

#[derive(Serialize)]
pub struct Tokens {
    url: String,
    token: String,
    screen_token: String,
}

#[derive(Deserialize)]
struct ActiveRooms {
    rooms: Option<Vec<ActiveRoom>>,
}

#[derive(Deserialize)]
struct ActiveRoom {
    name: String,
}

#[derive(Deserialize)]
struct Participants {
    participants: Option<Vec<Participant>>,
}

#[derive(Deserialize)]
struct Participant {
    identity: String,
}

#[derive(Default)]
pub struct Presence(BTreeMap<String, HashSet<String>>);

impl Presence {
    pub fn room_status(&self, id: &str) -> (usize, bool) {
        let Some(identities) = self.0.get(id) else {
            return (0, false);
        };
        let mut no_ar = false;
        let people: HashSet<_> = identities
            .iter()
            .map(|identity| {
                if let Some(user) = identity.strip_suffix(":tela") {
                    no_ar = true;
                    user
                } else {
                    identity.as_str()
                }
            })
            .collect();
        (people.len(), no_ar)
    }

    pub fn room_for(&self, user: &str) -> Option<&str> {
        let find = |id: &str| {
            self.0
                .iter()
                .find(|(_, identities)| identities.contains(id))
                .map(|(room, _)| room.as_str())
        };
        find(user).or_else(|| find(&format!("{user}:tela")))
    }
}

impl LiveKit {
    pub fn new(
        key: String,
        secret: String,
        public_url: String,
        internal_url: Url,
    ) -> reqwest::Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            key,
            secret,
            public_url,
            internal_url,
            client,
        })
    }

    pub fn tokens(&self, user_id: &str, name: &str, room: String) -> Result<Tokens, StatusCode> {
        let grants = VideoGrants {
            room_join: true,
            room,
            ..Default::default()
        };
        let token = AccessToken::with_api_key(&self.key, &self.secret)
            .with_identity(user_id)
            .with_name(name)
            .with_ttl(TOKEN_TTL)
            .with_grants(grants.clone())
            .to_jwt()
            .map_err(crate::db::internal)?;
        let screen_token = AccessToken::with_api_key(&self.key, &self.secret)
            .with_identity(&format!("{user_id}:tela"))
            .with_name(name)
            .with_ttl(TOKEN_TTL)
            .with_grants(VideoGrants {
                can_publish: Some(true),
                can_subscribe: Some(false),
                can_publish_data: Some(false),
                can_publish_sources: vec!["screen_share".into(), "screen_share_audio".into()],
                ..grants
            })
            .to_jwt()
            .map_err(crate::db::internal)?;
        Ok(Tokens {
            url: self.public_url.clone(),
            token,
            screen_token,
        })
    }

    async fn call(
        &self,
        method: &str,
        grants: VideoGrants,
        body: Value,
    ) -> Result<reqwest::Response, StatusCode> {
        let token = AccessToken::with_api_key(&self.key, &self.secret)
            .with_ttl(Duration::from_secs(30))
            .with_grants(grants)
            .to_jwt()
            .map_err(crate::db::internal)?;
        let mut url = self.internal_url.clone();
        url.set_path(&format!("/twirp/livekit.RoomService/{method}"));
        self.client
            .post(url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)
    }

    async fn active_rooms(&self) -> Result<Vec<ActiveRoom>, StatusCode> {
        let grants = VideoGrants {
            room_list: true,
            ..Default::default()
        };
        let rooms: ActiveRooms = self
            .call("ListRooms", grants, json!({}))
            .await?
            .error_for_status()
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .json()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        Ok(rooms.rooms.unwrap_or_default())
    }

    pub async fn online(&self) -> Presence {
        self.try_online()
            .await
            .inspect_err(|status| {
                eprintln!("Aviso: presença do LiveKit indisponível ({status})");
            })
            .unwrap_or_default()
    }

    async fn try_online(&self) -> Result<Presence, StatusCode> {
        let rooms = stream::iter(self.active_rooms().await?)
            .map(|room| async move {
                let grants = VideoGrants {
                    room_admin: true,
                    room: room.name.clone(),
                    ..Default::default()
                };
                let reply = self
                    .call("ListParticipants", grants, json!({"room": room.name}))
                    .await?;
                if reply.status() == StatusCode::NOT_FOUND {
                    return Ok::<_, StatusCode>((room.name, HashSet::new()));
                }
                let people: Participants = reply
                    .error_for_status()
                    .map_err(|_| StatusCode::BAD_GATEWAY)?
                    .json()
                    .await
                    .map_err(|_| StatusCode::BAD_GATEWAY)?;
                let identities = people
                    .participants
                    .unwrap_or_default()
                    .into_iter()
                    .map(|participant| participant.identity)
                    .collect();
                Ok((room.name, identities))
            })
            .buffer_unordered(8)
            .try_collect()
            .await?;
        Ok(Presence(rooms))
    }

    pub async fn kick(&self, user_id: &str) -> Result<(), StatusCode> {
        let screen_id = format!("{user_id}:tela");
        let rooms = self.active_rooms().await?;
        let targets = rooms.into_iter().flat_map(|room| {
            [user_id.to_owned(), screen_id.clone()].map(|identity| (room.name.clone(), identity))
        });
        let results: Vec<_> = stream::iter(targets)
            .map(|(room, identity)| async move {
                let grants = VideoGrants {
                    room_admin: true,
                    room: room.clone(),
                    ..Default::default()
                };
                let response = self
                    .call(
                        "RemoveParticipant",
                        grants,
                        json!({"room": room, "identity": identity}),
                    )
                    .await?;
                if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
                    Ok(())
                } else {
                    Err(StatusCode::BAD_GATEWAY)
                }
            })
            .buffer_unordered(8)
            .collect()
            .await;
        results.into_iter().collect()
    }
}
