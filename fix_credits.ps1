# Run from frontend folder
$f = Get-Content "src\pages\CreditsPage.jsx" -Raw
$f = $f -replace "  function PAY_METHODS\(\) \{\}\r?\n\}", "}"
$f = $f -replace "  function PAY_METHODS\(\) \{\}\n\}", "}"
Set-Content "src\pages\CreditsPage.jsx" -Value $f -Encoding UTF8
Write-Host "Credits fixed!" -ForegroundColor Green
