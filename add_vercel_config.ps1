# Run from FRONTEND folder
# Creates vercel.json to proxy API calls through Vercel
Set-Content -Path "vercel.json" -Encoding UTF8 -Value @'
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://partenaire-account-api.onrender.com/api/:path*"
    }
  ]
}
'@
Write-Host "vercel.json created!" -ForegroundColor Green
