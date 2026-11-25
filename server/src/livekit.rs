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
    sala_id: String,
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
    #[serde(default)]
    tracks: Vec<Track>,
}

#[derive(Deserialize)]
struct Track {
    sid: String,
    #[serde(default)]
    source: Value,
}

#[derive(Default)]
pub struct Presence(BTreeMap<String, HashSet<String>>);

impl Presence {
    pub fn occupied(&self) -> bool {
        self.0.values().any(|room| !room.is_empty())
    }

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
            room: room.clone(),
            ..Default::default()
        };
        let token = AccessToken::with_api_key(&self.key, &self.secret)
            .with_identity(user_id)
            .with_name(name)
            .with_ttl(TOKEN_TTL)
            .with_grants(VideoGrants {
                can_update_own_metadata: Some(true),
                ..grants.clone()
            })
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
            sala_id: room,
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

    pub async fn ready(&self) -> bool {
        self.active_rooms().await.is_ok()
    }

    pub async fn try_online(&self) -> Result<Presence, StatusCode> {
        let rooms = stream::iter(self.active_rooms().await?)
            .map(|room| async move {
                let identities = self
                    .participants(&room.name)
                    .await?
                    .into_iter()
                    .map(|participant| participant.identity)
                    .collect();
                Ok::<_, StatusCode>((room.name, identities))
            })
            .buffer_unordered(8)
            .try_collect()
            .await?;
        Ok(Presence(rooms))
    }

    async fn room_call(
        &self,
        method: &str,
        room: &str,
        body: Value,
    ) -> Result<reqwest::Response, StatusCode> {
        self.call(
            method,
            VideoGrants {
                room_admin: true,
                room: room.into(),
                ..Default::default()
            },
            body,
        )
        .await
    }

    async fn participants(&self, room: &str) -> Result<Vec<Participant>, StatusCode> {
        let reply = self
            .room_call("ListParticipants", room, json!({"room": room}))
            .await?;
        if reply.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        let people: Participants = reply
            .error_for_status()
            .map_err(|_| StatusCode::BAD_GATEWAY)?
            .json()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?;
        Ok(people.participants.unwrap_or_default())
    }

    pub async fn mute_room(&self, room: &str) -> Result<(), StatusCode> {
        let participants = self.participants(room).await?;
        let tracks = participants.into_iter().flat_map(|person| {
            person
                .tracks
                .into_iter()
                .filter(|track| track.source == "MICROPHONE" || track.source == 2)
                .map(move |track| (person.identity.clone(), track.sid))
        });
        let results: Vec<_> = stream::iter(tracks)
            .map(|(identity, sid)| async move {
                let reply = self
                    .room_call(
                        "MutePublishedTrack",
                        room,
                        json!({
                            "room": room, "identity": identity, "trackSid": sid, "muted": true,
                        }),
                    )
                    .await?;
                room_action_status(reply.status())
            })
            .buffer_unordered(8)
            .collect()
            .await;
        results.into_iter().collect()
    }

    pub async fn move_person(
        &self,
        room: &str,
        user_id: &str,
        destination: &str,
    ) -> Result<bool, StatusCode> {
        if !self
            .participants(room)
            .await?
            .iter()
            .any(|person| person.identity == user_id)
        {
            return Err(StatusCode::NOT_FOUND);
        }
        let reply = self
            .call(
                "MoveParticipant",
                VideoGrants {
                    room_admin: true,
                    room: room.into(),
                    destination_room: destination.into(),
                    ..Default::default()
                },
                json!({"room": room, "identity": user_id, "destinationRoom": destination}),
            )
            .await?;
        match reply.status() {
            status if status.is_success() => return Ok(false),
            StatusCode::NOT_FOUND => return Err(StatusCode::NOT_FOUND),
            StatusCode::NOT_IMPLEMENTED => {}
            status if status.is_server_error() => {
                let error: Value = reply.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
                let unsupported = error["code"] == "unimplemented"
                    || error["msg"]
                        .as_str()
                        .is_some_and(|msg| msg.contains("not implemented"));
                if !unsupported {
                    return Err(StatusCode::BAD_GATEWAY);
                }
            }
            _ => return Err(StatusCode::BAD_GATEWAY),
        }
        self.remove_from_room(room, user_id).await?;
        Ok(true)
    }

    pub async fn remove_from_room(&self, room: &str, user_id: &str) -> Result<(), StatusCode> {
        let screen = format!("{user_id}:tela");
        let (voice, screen) = tokio::join!(self.remove(room, user_id), self.remove(room, &screen));
        voice.and(screen)
    }

    async fn remove(&self, room: &str, identity: &str) -> Result<(), StatusCode> {
        let reply = self
            .room_call(
                "RemoveParticipant",
                room,
                json!({"room": room, "identity": identity}),
            )
            .await?;
        room_action_status(reply.status())
    }

    pub async fn kick(&self, user_id: &str) -> Result<(), StatusCode> {
        let rooms = self.active_rooms().await?;
        let results: Vec<_> = stream::iter(rooms)
            .map(|room| async move { self.remove_from_room(&room.name, user_id).await })
            .buffer_unordered(4)
            .collect()
            .await;
        results.into_iter().collect()
    }
}

fn room_action_status(status: StatusCode) -> Result<(), StatusCode> {
    if status.is_success() || status == StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err(StatusCode::BAD_GATEWAY)
    }
}
