# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop app in Tauri 2. The interface runs in WebView2 (Chromium) on Windows; Linux and macOS are later. There is no mobile app in the first phases.

## Stack

React + Vite + TypeScript + Tailwind, with Radix/shadcn components (decided in `docs/PLANO.md`). Design prototypes in `docs/design/` are static HTML/CSS so they can be opened without a build.

## Users

A private group of friends in Brazil, invited by Filippe. They use it in the evening and on weekends: playing different games together with voice, watching a film or series together, and chatting. Not only one game. Most have gaming PCs with dedicated GPUs; some have weaker machines or slower upload.

## Product Purpose

Replace what Discord stopped doing in Brazil since 17/08/2026 (Go Live and video suspended by ANPD): voice rooms plus screen sharing in good quality, with game audio, among friends. Success: the group stops needing Discord for calls and streams, and anyone can start a stream in a few clicks and know beforehand what quality their PC and internet can hold.

## Positioning

The streamer's own GPU encodes the video, so quality is limited only by their hardware and upload, never by a paid tier. Before streaming, the app tests the PC and shows each quality option (720p30 to 4K60) with the upload it uses, the GPU load and the data per hour for each viewer, or the exact reason it is locked.

## Operating Context

- Long sessions with a game or a film running in full screen; the app sits on a second monitor or behind the game.
- Typical group: a handful of people in one room, one or two streaming at a time.
- The server is a VPS in the US East shared with other services; voice latency from Brazil is around 120 to 160 ms (not measured yet).
- Entry is by invite only. There is no public sign-up.

## Capabilities and Constraints

- Voice rooms, screen/window streaming with game audio, watching by click, room text chat, push-to-talk, per-person volume.
- Quality presets gated by a 15-second GPU and upload test; AV1 when the streamer's GPU encodes it, otherwise H.264.
- No hooks inside games (anti-cheat).
- Unsigned installer at first: friends pass the SmartScreen warning; PCs with Smart App Control on are blocked.
- Code private now, public later; nothing copied from AGPL/GPL projects or from Discord.

## Brand Commitments

- Name: **Stackcall**.
- Interface language: Brazilian Portuguese.
- Voice: middle ground. Menus and settings are clear and direct; light humor only in empty states and notices.
- Visual direction chosen by Filippe on 24/11/2026: dark neutral with a purple accent (references in `E:\Repo\Pessoal\Meu PC\stackcall-design\REFERENCIAS.md`, kept outside the repo because they are third-party work).

## Evidence on Hand

No logo, icon, screenshots, users or testimonials exist yet. Do not invent them.

## Product Principles

1. Quality is honest: never offer an option the PC or connection cannot hold, and always say why.
2. The game comes first: the app stays out of the way during long full-screen sessions.
3. Starting a stream takes a few clicks; advanced settings are optional.
4. Private by default: invite-only, no public discovery.
5. Free of paywalls: every quality the hardware supports is available to everyone.
