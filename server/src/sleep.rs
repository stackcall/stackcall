use crate::{
    Config,
    livekit::{LiveKit, Presence},
    origin, required,
};
use axum::http::StatusCode;
use std::{env, io, sync::Arc, time::Duration};
use tokio::{
    sync::Mutex,
    time::{self, Instant},
};
use url::Url;

const POLL: Duration = Duration::from_secs(5);
const WAKE_LIMIT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Power {
    Unknown,
    Running,
    Stopped,
    Waking,
}

struct Activity {
    power: Power,
    idle_since: Option<Instant>,
}

pub struct Sleep {
    idle: Duration,
    controller: Url,
    client: reqwest::Client,
    activity: Mutex<Activity>,
}

impl Sleep {
    pub fn from_env() -> io::Result<Option<Self>> {
        let minutes = env::var("LIVEKIT_IDLE_MINUTES")
            .unwrap_or_else(|_| "0".into())
            .parse::<u64>()
            .ok()
            .filter(|minutes| *minutes <= 10_080)
            .ok_or_else(|| io::Error::other("LIVEKIT_IDLE_MINUTES deve estar entre 0 e 10080"))?;
        if minutes == 0 {
            return Ok(None);
        }
        Self::new(
            Duration::from_secs(minutes * 60),
            origin(&required("LIVEKIT_CONTROL_URL")?)?,
        )
        .map(Some)
    }

    pub(crate) fn new(idle: Duration, controller: Url) -> io::Result<Self> {
        Ok(Self {
            idle,
            controller,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(8))
                .build()
                .map_err(io::Error::other)?,
            activity: Mutex::new(Activity {
                power: Power::Unknown,
                idle_since: None,
            }),
        })
    }

    async fn control(&self, command: &str) -> bool {
        let mut url = self.controller.clone();
        url.set_path(command);
        self.client.post(url).send().await.is_ok_and(|reply| {
            reply.status().is_success() || reply.status() == StatusCode::NOT_MODIFIED
        })
    }

    pub(crate) async fn check_idle(&self, livekit: &LiveKit) {
        let mut activity = self.activity.lock().await;
        if matches!(activity.power, Power::Stopped | Power::Waking) {
            return;
        }
        let Ok(Ok(online)) = time::timeout(Duration::from_secs(3), livekit.try_online()).await
        else {
            activity.power = Power::Unknown;
            activity.idle_since = None;
            return;
        };
        activity.power = Power::Running;
        if online.occupied() {
            activity.idle_since = None;
            return;
        }
        if activity
            .idle_since
            .get_or_insert_with(Instant::now)
            .elapsed()
            < self.idle
        {
            return;
        }
        if self.control("/stop").await {
            activity.power = Power::Stopped;
        } else {
            activity.power = Power::Unknown;
            eprintln!("Aviso: não foi possível parar o LiveKit pelo controlador");
        }
        activity.idle_since = None;
    }

    async fn wake(&self, livekit: &LiveKit) {
        let started = time::timeout(WAKE_LIMIT, async {
            if !self.control("/start").await {
                return false;
            }
            while !livekit.ready().await {
                time::sleep(Duration::from_millis(500)).await;
            }
            true
        })
        .await;
        let mut activity = self.activity.lock().await;
        if matches!(started, Ok(true)) {
            activity.power = Power::Running;
            activity.idle_since = Some(Instant::now());
        } else {
            activity.power = Power::Unknown;
            eprintln!("Aviso: o LiveKit não respondeu dentro da tentativa de despertar");
        }
    }
}

pub fn monitor(config: Arc<Config>) {
    if config.sleep.is_some() {
        tokio::spawn(async move {
            let sleep = config.sleep.as_ref().expect("configured sleeper");
            let mut timer = time::interval(POLL);
            timer.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                sleep.check_idle(&config.livekit).await;
            }
        });
    }
}

pub async fn token_ready(config: &Arc<Config>) -> bool {
    let Some(sleep) = &config.sleep else {
        return true;
    };
    let mut activity = sleep.activity.lock().await;
    if activity.power == Power::Running {
        activity.idle_since = Some(Instant::now());
        return true;
    }
    if activity.power != Power::Waking {
        activity.power = Power::Waking;
        let config = config.clone();
        tokio::spawn(async move {
            let sleep = config.sleep.as_ref().expect("configured sleeper");
            sleep.wake(&config.livekit).await;
        });
    }
    false
}

pub async fn try_presence(config: &Config) -> Result<Presence, StatusCode> {
    if let Some(sleep) = &config.sleep
        && matches!(
            sleep.activity.lock().await.power,
            Power::Stopped | Power::Waking
        )
    {
        return Ok(Presence::default());
    }
    config.livekit.try_online().await
}

pub async fn presence(config: &Config) -> Presence {
    try_presence(config)
        .await
        .inspect_err(|status| {
            eprintln!("Aviso: presença do LiveKit indisponível ({status})");
        })
        .unwrap_or_default()
}
