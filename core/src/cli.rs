use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;

#[derive(Parser)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    Probe,
    Sources,
    Publish(Publish),
    Clock,
}

#[derive(Args)]
pub struct Publish {
    #[arg(long)]
    pub url: String,
    #[arg(long, required_unless_present = "control_stdin")]
    pub token: Option<String>,
    #[arg(long)]
    pub control_stdin: bool,
    #[arg(long)]
    pub source: Source,
    #[arg(long)]
    pub codec: Codec,
    #[arg(long)]
    pub res: Resolution,
    #[arg(long, value_parser = parse_fps)]
    pub fps: u32,
    #[arg(long, help = "Limit WGC capture updates to the target frame rate")]
    pub limit_capture_fps: bool,
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=100_000))]
    pub bitrate: u32,
    #[arg(long, help = "Use low-latency CBR with a short video buffer")]
    pub cbr: bool,
    #[arg(long, help = "Apply bitrate hysteresis and reuse the conversion path")]
    pub adaptive_bitrate: bool,
    #[arg(long, default_value = "auto")]
    pub encoder: Encoder,
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..))]
    pub audio_pid: Option<u32>,
    #[arg(long)]
    pub cpu_path: bool,
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..))]
    pub duration: Option<u64>,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Codec {
    H264,
    Av1,
}

#[derive(Clone, Copy, ValueEnum, Serialize)]
pub enum Resolution {
    #[value(name = "720p")]
    #[serde(rename = "720p")]
    P720,
    #[value(name = "1080p")]
    #[serde(rename = "1080p")]
    P1080,
    #[value(name = "1440p")]
    #[serde(rename = "1440p")]
    P1440,
    #[value(name = "4k")]
    #[serde(rename = "4k")]
    P4k,
}

impl Resolution {
    pub fn dimensions(self) -> (u32, u32) {
        match self {
            Self::P720 => (1280, 720),
            Self::P1080 => (1920, 1080),
            Self::P1440 => (2560, 1440),
            Self::P4k => (3840, 2160),
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Encoder {
    Auto,
    Nvenc,
    Amf,
    Qsv,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Monitor(usize),
    Window(String),
    Pid(u32),
    WindowHandle { handle: usize, pid: u32 },
    MonitorHandle(usize),
}

impl std::str::FromStr for Source {
    type Err = &'static str;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let invalid =
            "source must be monitor:<zero-based index>, window:<title> or pid:<positive ID>";
        match value.split_once(':') {
            Some(("monitor", index)) => index.parse().map(Self::Monitor).map_err(|_| invalid),
            Some(("window", title)) if !title.trim().is_empty() => Ok(Self::Window(title.into())),
            Some(("pid", pid)) => pid
                .parse()
                .ok()
                .filter(|pid| *pid > 0)
                .map(Self::Pid)
                .ok_or(invalid),
            Some(("hwnd", identity)) => {
                let (handle, pid) = identity.split_once(':').ok_or(invalid)?;
                let handle = handle
                    .parse()
                    .ok()
                    .filter(|handle| *handle > 0)
                    .ok_or(invalid)?;
                let pid = pid.parse().ok().filter(|pid| *pid > 0).ok_or(invalid)?;
                Ok(Self::WindowHandle { handle, pid })
            }
            Some(("hmonitor", handle)) => handle
                .parse()
                .ok()
                .filter(|handle| *handle > 0)
                .map(Self::MonitorHandle)
                .ok_or(invalid),
            _ => Err(invalid),
        }
    }
}

fn parse_fps(value: &str) -> Result<u32, &'static str> {
    match value {
        "30" => Ok(30),
        "60" => Ok(60),
        _ => Err("fps must be 30 or 60"),
    }
}

pub fn bits_per_second(kbps: u32) -> usize {
    kbps as usize * 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_presets_and_bitrate() {
        assert_eq!(Resolution::P720.dimensions(), (1280, 720));
        assert_eq!(Resolution::P1080.dimensions(), (1920, 1080));
        assert_eq!(Resolution::P1440.dimensions(), (2560, 1440));
        assert_eq!(Resolution::P4k.dimensions(), (3840, 2160));
        assert_eq!(bits_per_second(18_000), 18_000_000);
    }

    #[test]
    fn parses_publish_and_rejects_invalid_options() {
        let mut args = [
            "stackcall-core",
            "publish",
            "--url",
            "wss://example.test",
            "--token",
            "test",
            "--source",
            "window:Game: menu",
            "--codec",
            "av1",
            "--res",
            "4k",
            "--fps",
            "60",
            "--bitrate",
            "18000",
        ];
        let Command::Publish(options) = Cli::try_parse_from(args).unwrap().command else {
            panic!()
        };
        assert_eq!(options.source, Source::Window("Game: menu".into()));
        assert_eq!(options.fps, 60);
        assert_eq!(options.bitrate, 18_000);
        args[13] = "90";
        assert!(Cli::try_parse_from(args).is_err());
        assert!("pid:0".parse::<Source>().is_err());
    }
}
