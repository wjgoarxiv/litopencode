#!/usr/bin/env python3
"""Offline beat and envelope analysis of the user's own supplied audio."""

import json
import sys
from pathlib import Path

import librosa
import numpy as np


def analyse(source: Path) -> dict:
    audio, rate = librosa.load(source, sr=22050, mono=True)
    if audio.size == 0:
        raise ValueError("audio has no decodable samples")
    hop = 512
    onset = librosa.onset.onset_strength(y=audio, sr=rate, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=rate, hop_length=hop, trim=False)
    beats = librosa.frames_to_time(beat_frames, sr=rate, hop_length=hop).round(6).tolist()
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset, sr=rate, hop_length=hop)
    onsets = librosa.frames_to_time(onset_frames, sr=rate, hop_length=hop).round(6).tolist()
    spectrum = np.abs(librosa.stft(audio, n_fft=2048, hop_length=hop))
    frequencies = librosa.fft_frequencies(sr=rate, n_fft=2048)
    bands = {}
    for name, lower, upper in (("low", 20, 250), ("mid", 250, 2000), ("high", 2000, 10000)):
        selection = (frequencies >= lower) & (frequencies < upper)
        values = spectrum[selection].mean(axis=0) if selection.any() else np.zeros(spectrum.shape[1])
        ceiling = float(np.quantile(values, 0.95)) if values.size else 0.0
        bands[name] = np.clip(values / max(ceiling, 1e-9), 0, 1).round(4).tolist()
    rms = librosa.feature.rms(S=spectrum)[0]
    rms_ceiling = float(np.quantile(rms, 0.95)) if rms.size else 0.0
    bands["rms"] = np.clip(rms / max(rms_ceiling, 1e-9), 0, 1).round(4).tolist()
    return {
        "schemaVersion": 1,
        "source": str(source.resolve()),
        "durationSec": round(len(audio) / rate, 6),
        "bpm": round(float(np.asarray(tempo).reshape(-1)[0]), 4),
        "beatGrid": beats,
        "barsEstimated": beats[::4],
        "onsets": onsets,
        "envelope": {"hopSec": hop / rate, "bands": bands},
        "pulseKinds": ["kick", "snare", "onset"],
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: audio-analysis.py <audio-file> <output-json>")
    result = analyse(Path(sys.argv[1]))
    destination = Path(sys.argv[2])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
