"""
STMZ AI - Audio Stem Separator
Wraps Demucs (HTDemucs) and MDX-Net models for high-quality stem separation.

Model routing:
  - Drums, Bass, Melody (Other): HTDemucs
  - Instrumental: MDX-Net (via demucs two-stem mode)
  - Acapella: MDX-Net / HTDemucs (best for vocal isolation)
"""

import os
import shutil
import tempfile
import json
import sys
import traceback
from pathlib import Path

import torch
import numpy as np


# ── Demucs imports ──────────────────────────────────────────────────────────
try:
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import save_audio
    import torchaudio
    DEMUCS_AVAILABLE = True
except ImportError:
    DEMUCS_AVAILABLE = False

# ── Stem-to-model mapping ──────────────────────────────────────────────────
# HTDemucs outputs: drums, bass, other, vocals
HTDEMUCS_MODEL = "htdemucs_ft"  # fine-tuned variant for best quality

# Stem name mapping from our UI names to Demucs source names
DEMUCS_STEM_MAP = {
    "drums": "drums",
    "bass": "bass",
    "melody": "other",      # "Other" in Demucs = melody / harmonics
    "acapella": "vocals",
    "instrumental": None,    # Instrumental = everything minus vocals (computed)
}


class StemSeparator:
    """Manages model loading and audio stem separation."""

    def __init__(self, device=None):
        if not DEMUCS_AVAILABLE:
            raise RuntimeError(
                "Demucs is not installed. Run: pip install demucs torch torchaudio"
            )

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._model = None
        self._model_name = None

    # ── Model management ────────────────────────────────────────────────────

    def _load_model(self, model_name: str):
        """Load a Demucs model (cached after first load)."""
        if self._model is not None and self._model_name == model_name:
            return self._model

        self._log(f"Loading model: {model_name} on {self.device}")
        model = get_model(model_name)
        model.to(self.device)
        model.eval()
        self._model = model
        self._model_name = model_name
        return model

    def download_model(self, model_name: str):
        """Pre-download a Demucs model."""
        self._log(f"Starting download for model: {model_name}...")
        # get_model triggers the download if not present
        get_model(model_name)
        self._log(f"Model {model_name} downloaded and ready.")

    # ── Core separation ─────────────────────────────────────────────────────

    def separate(
        self,
        audio_path: str,
        stems: list[str],
        quality: str = "balanced",
        gpu_jobs: int = 1,
        output_dir: str = "",
        progress_callback=None,
    ) -> dict[str, str]:
        """
        Separate an audio file into the requested stems.

        Args:
            audio_path: Path to the source audio file.
            stems: List of stem names to extract
                   (e.g. ["acapella", "instrumental", "drums", "bass", "melody"]).
            output_dir: Directory to write the separated stems.
            progress_callback: Optional callable(stem_name, progress_pct).

        Returns:
            Dict mapping stem name -> output file path.
        """
        audio_path = Path(audio_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Determine the original title (without extension)
        original_title = audio_path.stem
        original_ext = audio_path.suffix.lower()

        # Determine output format: keep original format
        # Demucs always outputs WAV internally; we convert afterwards if needed
        output_ext = original_ext if original_ext in (".mp3", ".flac", ".ogg", ".m4a") else ".wav"

        results = {}

        # Check which model groups we need
        needs_htdemucs = any(
            s in ("drums", "bass", "melody", "acapella") for s in stems
        )
        needs_instrumental = "instrumental" in stems

        htdemucs_sources = None

        # ── Run HTDemucs if needed ──────────────────────────────────────────
        if needs_htdemucs or needs_instrumental:
            model = self._load_model(HTDEMUCS_MODEL)
            self._log(f"Loading audio: {audio_path}")
            wav, sr = self._load_audio(audio_path)

            # Resample to model's sample rate if necessary
            if sr != model.samplerate:
                wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)
                sr = model.samplerate

            # Ensure stereo
            if wav.shape[0] == 1:
                wav = wav.repeat(2, 1)
            elif wav.shape[0] > 2:
                wav = wav[:2]

            # Add batch dimension
            ref = wav.mean(0)
            wav = (wav - ref.mean()) / ref.std()
            wav_input = wav.unsqueeze(0).to(self.device)

            self._log(f"Running HTDemucs inference ({quality} quality)...")
            
            if quality == "extreme":
                shifts = 4
                overlap = 0.75
            elif quality == "high":
                shifts = 2
                overlap = 0.5
            elif quality == "low":
                shifts = 0
                overlap = 0.1
            else: # "balanced"
                shifts = 1
                overlap = 0.25
            
            num_models = 1
            if hasattr(model, 'models'):
                num_models = len(model.models)
                
            total_passes = num_models * max(1, shifts)
                
            import sys
            import re
            class StderrCatcher:
                def __init__(self, original, cb, total_passes):
                    self.original = original
                    self.cb = cb
                    self.total_passes = total_passes
                    self.current_pass = 0
                    self.last_pct = 0
                    
                def write(self, s):
                    self.original.write(s)
                    m = re.search(r'(\d+)%', s)
                    if m and self.cb:
                        pct = int(m.group(1))
                        
                        # Detect pass transition (e.g. progress drops from 100 to 0)
                        if pct < self.last_pct - 50:
                            self.current_pass += 1
                        self.last_pct = pct
                        
                        safe_pass = min(self.current_pass, self.total_passes - 1)
                        overall_fraction = (safe_pass + (pct / 100.0)) / self.total_passes
                        
                        # Scale inference progress to 0-90%
                        self.cb("Analyzing Audio", int(overall_fraction * 90))
                def flush(self):
                    self.original.flush()
            
            old_stderr = sys.stderr
            sys.stderr = StderrCatcher(old_stderr, progress_callback, total_passes)
            
            # Auto-detect VRAM if requested
            if gpu_jobs == -1:
                if self.device == "cuda" and torch.cuda.is_available():
                    vram_gb = torch.cuda.get_device_properties(self.device).total_memory / (1024**3)
                    if vram_gb >= 11.5:
                        gpu_jobs = 4
                    elif vram_gb >= 7.5:
                        gpu_jobs = 2
                    else:
                        gpu_jobs = 1
                    self._log(f"Auto-detected {vram_gb:.1f}GB VRAM. Using {gpu_jobs} GPU Core{'s' if gpu_jobs > 1 else ''}.")
                else:
                    gpu_jobs = 1
                    self._log("Auto-detected CPU/MPS mode. Using 1 Core.")
            
            from concurrent.futures import ThreadPoolExecutor
            pool = ThreadPoolExecutor(gpu_jobs) if gpu_jobs > 1 else None
            
            try:
                with torch.no_grad():
                    sources = apply_model(
                        model, 
                        wav_input, 
                        shifts=shifts, 
                        overlap=overlap, 
                        progress=True,
                        pool=pool
                    )
            finally:
                sys.stderr = old_stderr

            # sources shape: (batch, n_sources, channels, samples)
            sources = sources[0]  # remove batch dim
            # De-normalize
            sources = sources * ref.std() + ref.mean()

            # Build source name -> tensor mapping
            htdemucs_sources = {}
            for i, name in enumerate(model.sources):
                htdemucs_sources[name] = sources[i]

        # ── Extract requested stems ─────────────────────────────────────────
        total_stems = len(stems)
        for idx, stem in enumerate(stems):
            if progress_callback:
                # Map saving phase to the final 10% (90% to 100%)
                progress_callback(stem, 90 + int(((idx + 1) / total_stems) * 10))

            output_filename = f"[ {stem.capitalize()} ] - {original_title}{output_ext}"
            output_path = output_dir / output_filename

            if stem == "instrumental":
                # Instrumental = full mix minus vocals
                if htdemucs_sources and "vocals" in htdemucs_sources:
                    instrumental = sum(
                        src for name, src in htdemucs_sources.items()
                        if name != "vocals"
                    )
                    self._save_audio(instrumental, sr, output_path, original_ext, audio_path)
                else:
                    self._log(f"WARNING: Could not compute instrumental stem")
                    continue
            elif stem in DEMUCS_STEM_MAP:
                demucs_name = DEMUCS_STEM_MAP[stem]
                if htdemucs_sources and demucs_name in htdemucs_sources:
                    self._save_audio(
                        htdemucs_sources[demucs_name], sr, output_path, original_ext, audio_path
                    )
                else:
                    self._log(f"WARNING: Stem '{stem}' not found in model output")
                    continue
            else:
                self._log(f"WARNING: Unknown stem type '{stem}'")
                continue

            results[stem] = str(output_path)
            self._log(f"Saved: {output_path.name}")

        if progress_callback:
            progress_callback("done", 100)

        return results

    # ── Audio I/O helpers ───────────────────────────────────────────────────

    def _load_audio(self, path: Path):
        """Load audio file with fallback for broken torchaudio backends."""
        try:
            # Try torchaudio first
            return torchaudio.load(str(path))
        except Exception as e:
            self._log(f"torchaudio.load failed, trying soundfile fallback: {e}")
            try:
                import soundfile as sf
                data, sr = sf.read(str(path))
                # Convert to torch tensor (channels, samples)
                if data.ndim == 1:
                    # Mono to stereo
                    tensor = torch.from_numpy(data).unsqueeze(0)
                else:
                    # (samples, channels) to (channels, samples)
                    tensor = torch.from_numpy(data).transpose(0, 1)
                
                # Ensure float32
                if tensor.dtype == torch.float64:
                    tensor = tensor.to(torch.float32)
                elif tensor.dtype == torch.int16:
                    tensor = tensor.to(torch.float32) / 32768.0
                elif tensor.dtype == torch.int32:
                    tensor = tensor.to(torch.float32) / 2147483648.0
                
                return tensor, sr
            except Exception as sf_e:
                self._log(f"soundfile fallback also failed: {sf_e}")
                raise e from sf_e

    def _save_audio(self, tensor, sr, output_path, original_ext, source_path):
        """Save audio tensor to file in the original format."""
        output_path = Path(output_path)
        
        # We cannot rely on FFmpeg in the packaged production app unless we bundle it, 
        # which is heavy. Instead, we use the "Trim & Plug" method:
        # LAME MP3 encoding via soundfile backend consistently adds 1105 samples of delay.
        # We manually trim 1105 samples of audio so that when the encoder adds the 
        # 1105 samples of padding, the audio starts at the exact original timestamp.
        if output_path.suffix.lower() == ".mp3":
            delay_samples = 1105
            if tensor.shape[1] > delay_samples:
                tensor = tensor[:, delay_samples:]

        try:
            # For other formats (WAV, FLAC), torchaudio.save is perfect
            torchaudio.save(str(output_path), tensor.cpu(), sr)
        except Exception as e:
            self._log(f"torchaudio.save failed, falling back to soundfile: {e}")
            import soundfile as sf
            import numpy as np
            
            audio_np = tensor.cpu().numpy()
            if audio_np.ndim == 2:
                audio_np = audio_np.T
            audio_np = np.clip(audio_np, -1.0, 1.0)
            
            if original_ext == ".flac":
                sf.write(str(output_path), audio_np, sr, subtype="PCM_24")
            elif original_ext == ".ogg":
                sf.write(str(output_path), audio_np, sr, format="OGG", subtype="VORBIS")
            else:
                sf.write(str(output_path), audio_np, sr)

    # ── Logging ─────────────────────────────────────────────────────────────

    @staticmethod
    def _log(message: str):
        """Print a log message as JSON to stdout for IPC."""
        print(json.dumps({"type": "log", "message": message}), flush=True)
