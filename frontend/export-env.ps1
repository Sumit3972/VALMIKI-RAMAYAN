# export-env.ps1
# Script to automate pulling environment variables from Vercel

$ErrorActionPreference = "Stop"

function Write-Step ($message) {
    Write-Host "`n[STEP] $message" -ForegroundColor Cyan
}

function Write-Success ($message) {
    Write-Host "[SUCCESS] $message" -ForegroundColor Green
}

function Write-WarningMsg ($message) {
    Write-Host "[WARNING] $message" -ForegroundColor Yellow
}

function Write-ErrorMsg ($message) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

# 1. Check/Install Vercel CLI
Write-Step "Checking for Vercel CLI..."
$vercelPath = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelPath) {
    $vercelPath = Get-Command vc -ErrorAction SilentlyContinue
}

if (-not $vercelPath) {
    Write-WarningMsg "Vercel CLI not found. Checking for npm to install it..."
    $npmPath = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmPath) {
        Write-ErrorMsg "npm is not installed. Please install Node.js/npm and run this script again."
        exit 1
    }
    
    Write-Host "Executing command: npm install -g vercel" -ForegroundColor Yellow
    npm install -g vercel
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Failed to install Vercel CLI via npm."
        exit 1
    }
    Write-Success "Vercel CLI installed successfully."
} else {
    Write-Success "Vercel CLI is already installed at: $($vercelPath.Source)"
}

# 2. Check if logged in
Write-Step "Checking Vercel authentication status..."
Write-Host "Executing command: vercel whoami" -ForegroundColor Yellow
$loginCheck = & vercel whoami 2>&1
if ($LASTEXITCODE -ne 0 -or $loginCheck -like "*Not logged in*") {
    Write-WarningMsg "You are not logged into Vercel. Redirecting to login..."
    Write-Host "Executing command: vercel login" -ForegroundColor Yellow
    vercel login
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Vercel login failed."
        exit 1
    }
    Write-Success "Logged in successfully."
} else {
    Write-Success "Already logged in as: $loginCheck"
}

# 3. Check if project is linked
Write-Step "Checking if project is linked to Vercel..."
if (-not (Test-Path ".vercel/project.json")) {
    Write-WarningMsg "Project is not linked to Vercel. Setting up link..."
    Write-Host "Executing command: vercel link --yes" -ForegroundColor Yellow
    vercel link --yes
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Failed to link project to Vercel."
        exit 1
    }
    Write-Success "Project linked successfully."
} else {
    Write-Success "Project is already linked to Vercel (found .vercel/project.json)."
}

# Define environments and target files
$envs = @(
    @{ Name = "production"; File = ".env.production" },
    @{ Name = "preview"; File = ".env.preview" },
    @{ Name = "development"; File = ".env.local" }
)

# 4. Pull environment variables
Write-Step "Pulling environment variables..."
foreach ($env in $envs) {
    $envName = $env.Name
    $fileName = $env.File
    
    # We display the command to the user before running
    Write-Host "Executing command: vercel env pull $fileName --environment $envName --yes" -ForegroundColor Yellow
    
    # Run the command
    vercel env pull $fileName --environment $envName --yes
    
    # Check if the command succeeded
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Failed to pull environment variables for $envName environment."
        exit 1
    }
    
    # 5. Verify files are created successfully and are not empty
    if (Test-Path $fileName) {
        $fileInfo = Get-Item $fileName
        if ($fileInfo.Length -gt 0) {
            Write-Success "Successfully saved $envName env variables to $fileName ($($fileInfo.Length) bytes)"
        } else {
            Write-WarningMsg "File $fileName was created but is empty. Check if you have environment variables defined for $envName in Vercel."
        }
    } else {
        Write-ErrorMsg "Expected file $fileName was not created."
        exit 1
    }
}

Write-Step "All steps completed successfully!"
