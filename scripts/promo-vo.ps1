# Generates the voiceover lines as individual WAVs so each can be placed at an
# exact timestamp in the cut, rather than hoping one long take lines up.
param([string]$OutDir, [string]$VoiceName = 'Microsoft David Desktop', [int]$Rate = 1)

Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$lines = @(
  @{ n = 'l1'; t = 'What if Claude had a place of its own?' },
  @{ n = 'l2'; t = 'Watch it think, and plan.' },
  @{ n = 'l3'; t = 'Then write the code, character by character.' },
  @{ n = 'l4'; t = 'Nova I D E.' }
)

foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($VoiceName)
  $s.Rate = $Rate
  $path = Join-Path $OutDir ($l.n + '.wav')
  $s.SetOutputToWaveFile($path)
  $s.Speak($l.t)
  $s.Dispose()
  $bytes = (Get-Item $path).Length
  '{0}  {1,8} bytes  "{2}"' -f $l.n, $bytes, $l.t
}
