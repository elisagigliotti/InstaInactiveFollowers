# ============================================================
#  Setup GitHub - Instagram Inactive Followers
#  Esegui questo script nella cartella InstaInactiveFollowers
# ============================================================

$repoName = "InstaInactiveFollowers"
$username = "elisagigliotti"
$folder = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "📱 Instagram Inactive Followers — Setup GitHub" -ForegroundColor Magenta
Write-Host "===============================================" -ForegroundColor Magenta
Write-Host ""

# 1. Vai nella cartella giusta
Set-Location $folder

# 2. Git init
Write-Host "▶ Inizializzazione repository git..." -ForegroundColor Cyan
git init
git branch -M main

# 3. Primo commit
Write-Host "▶ Aggiunta file e primo commit..." -ForegroundColor Cyan
git add .
git commit -m "feat: initial release of Instagram Inactive Followers tool"

# 4. Crea il repo su GitHub via gh CLI (se disponibile) oppure guida manuale
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "▶ Creazione repo su GitHub..." -ForegroundColor Cyan
    gh repo create $repoName --public --description "Find and remove inactive Instagram followers directly from your browser" --push --source .

    Write-Host ""
    Write-Host "▶ Abilitazione GitHub Pages..." -ForegroundColor Cyan
    gh api repos/$username/$repoName/pages --method POST -f source='{"branch":"main","path":"/"}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Tutto fatto!" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Repo:  https://github.com/$username/$repoName" -ForegroundColor White
        Write-Host "  Sito:  https://$username.github.io/$repoName/" -ForegroundColor White
        Write-Host ""
        Write-Host "  (Il sito può richiedere 1-2 minuti per essere online)" -ForegroundColor Gray
    }
} else {
    # gh non installato — push manuale
    Write-Host ""
    Write-Host "⚠️  GitHub CLI (gh) non trovato." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Fai questi 2 passaggi manualmente:" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. Crea il repo su GitHub:" -ForegroundColor Cyan
    Write-Host "     https://github.com/new" -ForegroundColor White
    Write-Host "     Nome: $repoName" -ForegroundColor White
    Write-Host "     Visibilità: Public" -ForegroundColor White
    Write-Host "     NON aggiungere README o .gitignore" -ForegroundColor White
    Write-Host ""
    Write-Host "  2. Poi torna qui e lancia:" -ForegroundColor Cyan
    Write-Host "     git remote add origin https://github.com/$username/$repoName.git" -ForegroundColor White
    Write-Host "     git push -u origin main" -ForegroundColor White
    Write-Host ""
    Write-Host "  3. Infine abilita GitHub Pages:" -ForegroundColor Cyan
    Write-Host "     Settings → Pages → Source: main → Save" -ForegroundColor White
    Write-Host ""
    Write-Host "  Sito finale: https://$username.github.io/$repoName/" -ForegroundColor Green
}

Write-Host ""
Read-Host "Premi Invio per chiudere"
