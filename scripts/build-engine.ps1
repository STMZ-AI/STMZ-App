$ErrorActionPreference = "Stop"

$ProjectRoot = "d:\dev\STMZ_AI"
$BinDir = "$ProjectRoot\bin\ffmpeg"
$ModelsDir = "$ProjectRoot\models"

Write-Host "Creating directories..."
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# 1. Download and extract FFmpeg
Write-Host "Downloading FFmpeg..."
$FfmpegZip = "$ProjectRoot\ffmpeg.zip"
if (-not (Test-Path "$BinDir\ffmpeg.exe")) {
    Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $FfmpegZip
    Write-Host "Extracting FFmpeg..."
    Expand-Archive -Path $FfmpegZip -DestinationPath "$ProjectRoot\ffmpeg_temp" -Force
    $ExtractedFolder = Get-ChildItem -Path "$ProjectRoot\ffmpeg_temp" | Select-Object -First 1
    Copy-Item -Path "$($ExtractedFolder.FullName)\bin\ffmpeg.exe" -Destination $BinDir -Force
    Copy-Item -Path "$($ExtractedFolder.FullName)\bin\ffprobe.exe" -Destination $BinDir -Force
    Remove-Item -Path $FfmpegZip -Force
    Remove-Item -Path "$ProjectRoot\ffmpeg_temp" -Recurse -Force
} else {
    Write-Host "FFmpeg already exists. Skipping download."
}

# 2. Prepare Python Environment and PyInstaller
Write-Host "Installing PyInstaller..."
pip install pyinstaller

# 3. Pre-download Demucs Models
Write-Host "Pre-downloading Demucs Models..."
$PreDownloadScript = @"
import torch
import os
from demucs.pretrained import get_model

# Ensure PyTorch uses the local models directory
os.environ['TORCH_HOME'] = r'$ModelsDir'

print('Loading htdemucs_ft to trigger download...')
get_model('htdemucs_ft')
print('Model downloaded successfully.')
"@

$PreDownloadScript | Out-File -FilePath "$ProjectRoot\download_model.py" -Encoding UTF8
python "$ProjectRoot\download_model.py"
Remove-Item -Path "$ProjectRoot\download_model.py" -Force

# 4. Build PyInstaller Executable
Write-Host "Running PyInstaller..."
Set-Location -Path $ProjectRoot
# Use --onedir to avoid unpacking time and temp dir issues.
# hidden imports for torch/torchaudio are often needed.
pyinstaller --noconfirm --onedir --console `
    --name main `
    --paths engine `
    --hidden-import=separator `
    --hidden-import=metadata `
    --hidden-import=rekordbox_xml_manager `
    --hidden-import=torchaudio.lib.libtorchaudio `
    --hidden-import=torchaudio.lib.libtorchaudio_ffmpeg `
    --collect-all torch `
    --collect-all torchaudio `
    --collect-all demucs `
    --distpath dist-engine `
    --workpath build-engine `
    engine/main.py

Write-Host "Build complete! The standalone engine is in dist-engine/main."
