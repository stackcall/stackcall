# livekit 0.12.0 (patched)

Copy of the `livekit` crate 0.12.0 from crates.io (Apache-2.0, Copyright LiveKit, Inc.),
used through `[patch.crates-io]` in the root `Cargo.toml`. Only `src/`, `build.rs`,
`Cargo.toml` and `README.md` were copied.

Change made by Stackcall:

- `src/room/participant/local_participant.rs`, `prepare_publish`: an audio track whose
  source has two or more channels sets `stereo` and `TF_STEREO` in `AddTrackRequest`.
  Without it the SFU negotiates mono Opus and the game audio of a stream loses left/right.

Drop this copy when an upstream release publishes stereo audio on its own.
