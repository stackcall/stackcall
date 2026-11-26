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
mod mux;
#[cfg(windows)]
mod probe;
#[cfg(windows)]
mod publish;
#[cfg(windows)]
mod replay;
#[cfg(windows)]
mod sources;

use anyhow::Result;
use clap::Parser;

fn main() -> Result<()> {
    let args = cli::Cli::parse();
    #[cfg(windows)]
    match args.command {
        cli::Command::Probe(options) => {
            println!("{}", serde_json::to_string(&probe::run(options)?)?)
        }
        cli::Command::Sources => println!("{}", serde_json::to_string(&sources::list()?)?),
        cli::Command::Publish(options) => {
            let controlled = options.control_stdin;
            let result = tokio::runtime::Runtime::new()?.block_on(publish::run(options));
            match &result {
                Ok(()) => eprintln!("Fim: transmissão encerrada."),
                Err(error) => eprintln!("Fim com erro: {error:#}"),
            }
            if controlled {
                match &result {
                    Ok(()) => println!("{}", serde_json::json!({"event": "stopped"})),
                    Err(error) => println!(
                        "{}",
                        serde_json::json!({"event": "error", "reason": format!("{error:#}")})
                    ),
                }
            }
            result?
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
