# Перезапускает Яндекс Музыку с отладочным портом, чтобы tools/eval.js мог смотреть в страницу.
# Если порт не поднялся (например, приложение успели открыть вручную без него), пробует ещё раз.
$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs\YandexMusic\*.exe" | Where-Object { $_.Name -notmatch '^(Uninstall|elevate)' } | Sort-Object Length -Descending | Select-Object -First 1
foreach ($attempt in 1..3) {
  Get-Process | Where-Object { $_.Path -like '*\Programs\YandexMusic\*' } | Stop-Process -Force
  Start-Sleep -Seconds 2
  Start-Process -FilePath $exe.FullName -ArgumentList '--remote-debugging-port=9333', '--remote-allow-origins=*'
  foreach ($wait in 1..10) {
    Start-Sleep -Seconds 2
    try {
      $pages = Invoke-RestMethod 'http://127.0.0.1:9333/json' -TimeoutSec 2
      if ($pages | Where-Object { $_.type -eq 'page' -and $_.url -like 'music-application:*' }) { Start-Sleep -Seconds 5; 'ready'; exit 0 }
    } catch {}
  }
}
'debug port did not come up'
exit 1
