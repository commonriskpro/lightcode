# Recreate venv (Python 3.12) + PyTorch CUDA 12.4 + requirements.txt.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$py = "3.12"
$null = & py "-$py" "--version" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Install Python $py (e.g. winget install Python.Python.3.12) then re-run."
  exit 1
}

if (Test-Path .venv) { Remove-Item -Recurse -Force .venv }
& py "-$py" -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install torch torchvision --index-url https://download.pytorch.org/whl/cu124
& .\.venv\Scripts\pip.exe install -r requirements.txt
& .\.venv\Scripts\python.exe -c "import torch; print('torch', torch.__version__); print('cuda', torch.cuda.is_available())"
