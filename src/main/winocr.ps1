# Reads image paths from stdin, one per line, and prints the text lines Windows' built-in OCR finds in each.
# Output per request: "OK <json array of lines>" or "ERR <message>". Prints "READY" once at start.
$ErrorActionPreference = 'Stop'
# Node writes and reads UTF-8; the console default is the OEM code page.
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { [Console]::Out.WriteLine('ERR no OCR language installed'); exit 1 }
} catch {
  [Console]::Out.WriteLine('ERR ' + $_.Exception.Message); exit 1
}
[Console]::Out.WriteLine('READY')
$count = 0
while ($true) {
  # Request line: "<id> <path>". The id is echoed so a late reply can never be taken for a newer request.
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $sep = $line.IndexOf(' ')
  if ($sep -lt 1) { continue }
  $id = $line.Substring(0, $sep); $path = $line.Substring($sep + 1)
  $stream = $null; $bitmap = $null
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($result.Lines | ForEach-Object { $_.Text })
    [Console]::Out.WriteLine($id + ' OK ' + (ConvertTo-Json -Compress -InputObject $lines))
  } catch {
    [Console]::Out.WriteLine($id + ' ERR ' + $_.Exception.Message)
  } finally {
    if ($bitmap) { $bitmap.Dispose() }
    if ($stream) { $stream.Dispose() }
    $count++
    if ($count % 20 -eq 0) { [GC]::Collect() }
  }
}
