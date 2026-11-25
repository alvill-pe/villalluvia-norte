# Guarda las claves secretas de VillaLluvia en GitHub (Settings > Secrets), sin mostrarlas.
# Uso: abrir PowerShell en esta carpeta y ejecutar:  .\configurar-secretos.ps1
$repo = "alvill-pe/villalluvia-norte"

$vapid = Get-Content "motor/.local/vapid.secreto.json" | ConvertFrom-Json
$vapid.privateKey | gh secret set VAPID_PRIVADA --repo $repo
$vapid.publicKey  | gh secret set VAPID_PUBLICA --repo $repo
Write-Host "Claves de notificaciones guardadas." -ForegroundColor Green

$url = Read-Host "Pega la Project URL de Supabase (https://....supabase.co)"
$url.Trim() | gh secret set SUPABASE_URL --repo $repo
$secreta = Read-Host "Pega la clave SECRETA de Supabase (secret key o service_role)" -AsSecureString
[Net.NetworkCredential]::new('', $secreta).Password.Trim() | gh secret set SUPABASE_SECRET --repo $repo
Write-Host "Listo. Las claves de Supabase quedaron guardadas en GitHub." -ForegroundColor Green
