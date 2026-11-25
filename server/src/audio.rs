use axum::http::StatusCode;
use ogg::PacketReader;
use opus_decoder::OpusMultistreamDecoder;
use std::io::{Cursor, ErrorKind};
use symphonia_bundle_mp3::{MpaDecoder, MpaReader};
use symphonia_core::{
    codecs::{CODEC_TYPE_MP3, Decoder, DecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader},
    io::MediaSourceStream,
};

pub const MAX_BYTES: usize = 300_000;
const OPUS_RATE: u64 = 48_000;
const OPUS_FRAME_MAX: usize = 5760;
const INVALID: StatusCode = StatusCode::UNSUPPORTED_MEDIA_TYPE;

pub fn validate(bytes: Vec<u8>) -> Result<(&'static str, u64, Vec<u8>), StatusCode> {
    if bytes.len() > MAX_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    if bytes.starts_with(b"OggS") {
        let millis = opus_duration(&bytes)?;
        return Ok(("audio/ogg", millis, bytes));
    }
    let millis = mp3_duration(&bytes)?;
    Ok(("audio/mpeg", millis, bytes))
}

fn opus_duration(bytes: &[u8]) -> Result<u64, StatusCode> {
    let mut reader = PacketReader::new(Cursor::new(bytes));
    let header = reader.read_packet_expected().map_err(|_| INVALID)?;
    let data = header.data.as_slice();
    if !header.first_in_stream() || data.len() < 19 || !data.starts_with(b"OpusHead\x01") {
        return Err(INVALID);
    }
    let channels = usize::from(data[9]);
    let preskip = u64::from(u16::from_le_bytes([data[10], data[11]]));
    let (streams, coupled, mapping) = match data[18] {
        0 if data.len() == 19 && matches!(channels, 1 | 2) => {
            (1, channels - 1, &[0, 1][..channels])
        }
        1 if (1..=8).contains(&channels) && data.len() == 21 + channels => {
            (usize::from(data[19]), usize::from(data[20]), &data[21..])
        }
        _ => return Err(INVALID),
    };
    if streams + coupled > 8 {
        return Err(INVALID);
    }
    let tags = reader.read_packet_expected().map_err(|_| INVALID)?;
    if tags.stream_serial() != header.stream_serial()
        || tags.data.len() < 16
        || !tags.data.starts_with(b"OpusTags")
    {
        return Err(INVALID);
    }
    let mut decoder =
        OpusMultistreamDecoder::new(OPUS_RATE as u32, channels, streams, coupled, mapping)
            .map_err(|_| INVALID)?;
    let mut pcm = vec![0i16; OPUS_FRAME_MAX * channels];
    let mut frames = 0;
    loop {
        let packet = reader.read_packet_expected().map_err(|_| INVALID)?;
        if packet.stream_serial() != header.stream_serial()
            || packet.first_in_stream()
            || packet.data.is_empty()
        {
            return Err(INVALID);
        }
        let decoded = decoder
            .decode(&packet.data, &mut pcm, false)
            .map_err(|_| INVALID)? as u64;
        let previous_frames = frames;
        frames += decoded;
        if packet.last_in_stream() {
            let end = packet.absgp_page();
            if end <= previous_frames
                || end > frames
                || reader.into_inner().position() != bytes.len() as u64
            {
                return Err(INVALID);
            }
            return duration(end.saturating_sub(preskip), OPUS_RATE);
        }
        if frames >= preskip + 5 * OPUS_RATE {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
}

fn mp3_duration(bytes: &[u8]) -> Result<u64, StatusCode> {
    if !bytes.starts_with(b"ID3") && !matches!(bytes, [0xff, next, ..] if next & 0xe0 == 0xe0) {
        return Err(INVALID);
    }
    let stream = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut reader = MpaReader::try_new(stream, &FormatOptions::default()).map_err(|_| INVALID)?;
    let params = &reader.default_track().ok_or(INVALID)?.codec_params;
    if params.codec != CODEC_TYPE_MP3 {
        return Err(INVALID);
    }
    let rate = u64::from(params.sample_rate.ok_or(INVALID)?);
    let gapless = u64::from(params.delay.unwrap_or(0)) + u64::from(params.padding.unwrap_or(0));
    let declared_frames = params.n_frames;
    let mut decoder =
        MpaDecoder::try_new(params, &DecoderOptions::default()).map_err(|_| INVALID)?;
    let mut frames = 0;
    loop {
        let packet = match reader.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => break,
            Err(_) => return Err(INVALID),
        };
        let audio = decoder.decode(&packet).map_err(|_| INVALID)?;
        if u64::from(audio.spec().rate) != rate {
            return Err(INVALID);
        }
        frames += audio.frames() as u64;
        if frames > rate * 5 + gapless {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    if declared_frames == Some(frames) {
        frames = frames.saturating_sub(gapless);
    }
    duration(frames, rate)
}

fn duration(frames: u64, rate: u64) -> Result<u64, StatusCode> {
    if frames == 0 {
        Err(INVALID)
    } else if frames > 5 * rate {
        Err(StatusCode::UNPROCESSABLE_ENTITY)
    } else {
        Ok((frames * 1000).div_ceil(rate))
    }
}

#[cfg(test)]
pub fn silent_opus(packets: usize) -> Vec<u8> {
    use ogg::writing::{PacketWriteEndInfo as End, PacketWriter};
    let mut writer = PacketWriter::new(Vec::new());
    writer
        .write_packet(
            b"OpusHead\x01\x01\x00\x00\x80\xbb\x00\x00\x00\x00\x00".as_slice(),
            1,
            End::EndPage,
            0,
        )
        .unwrap();
    writer
        .write_packet(
            b"OpusTags\x00\x00\x00\x00\x00\x00\x00\x00".as_slice(),
            1,
            End::EndPage,
            0,
        )
        .unwrap();
    for i in 1..=packets {
        let end = if i == packets {
            End::EndStream
        } else {
            End::NormalPacket
        };
        writer
            .write_packet([0xf8, 0xff, 0xfe].as_slice(), 1, end, i as u64 * 960)
            .unwrap();
    }
    writer.into_inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_actual_audio_and_duration() {
        let opus = silent_opus(250);
        assert_eq!(validate(opus.clone()).unwrap().1, 5000);
        assert_eq!(
            validate(silent_opus(251)),
            Err(StatusCode::UNPROCESSABLE_ENTITY)
        );
        let mut chained = opus.clone();
        chained.extend(silent_opus(1));
        assert_eq!(validate(chained), Err(INVALID));
        assert_eq!(validate(opus[..opus.len() - 1].to_vec()), Err(INVALID));
        assert_eq!(validate(b"OggSOpusHead fake".to_vec()), Err(INVALID));
        assert_eq!(validate(b"ID3 fake".to_vec()), Err(INVALID));
        assert_eq!(
            validate(vec![0; MAX_BYTES + 1]),
            Err(StatusCode::PAYLOAD_TOO_LARGE)
        );

        let mut frame = vec![0; 417];
        frame[..4].copy_from_slice(&[0xff, 0xfb, 0x90, 0xc0]);
        let (format, millis, _) = validate(frame.repeat(10)).unwrap();
        assert_eq!((format, millis), ("audio/mpeg", 262));
        assert_eq!(
            validate(frame.repeat(220)),
            Err(StatusCode::UNPROCESSABLE_ENTITY)
        );
    }
}
