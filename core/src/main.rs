#[cfg(windows)]
mod audio;
mod cli;
#[cfg(windows)]
mod clock;
#[cfg(windows)]
mod encoder;
#[cfg(windows)]
mod gpu;
#[cfg(windows)]
mod media;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod publish;

use anyhow::Result;
use clap::Parser;

fn main() -> Result<()> {
    let args = cli::Cli::parse();
    #[cfg(windows)]
    match args.command {
        cli::Command::Probe => println!(
            "{}",
            serde_json::to_string(&probe::run(probe::ProbeOptions { seconds: 3 })?)?
        ),
        cli::Command::Publish(options) => {
            tokio::runtime::Runtime::new()?.block_on(publish::run(options))?
        }
        cli::Command::Clock => clock::run()?,
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        anyhow::bail!("stackcall-core requires Windows");
    }
    #[cfg(windows)]
    Ok(())
}
