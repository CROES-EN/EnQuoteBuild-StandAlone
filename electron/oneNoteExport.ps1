param(
  [string]$SourcePath,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

function Invoke-OneNoteRead([scriptblock]$Read) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { return (& $Read) } catch {
      $exception = $_.Exception
      while ($exception.InnerException) { $exception = $exception.InnerException }
      if ($exception.HResult.ToString("X8") -ne "8004201D" -or $attempt -eq 59) { throw }
      Start-Sleep -Seconds 1
    }
  }
}

function Convert-OneNoteNode($Node) {
  $parts = @()
  foreach ($child in $Node.ChildNodes) {
    switch ($child.LocalName) {
      "T" { $parts += "<p>" + $child.InnerText + "</p>" }
      "Table" { $parts += "<table>" + (Convert-OneNoteNode $child) + "</table>" }
      "Row" { $parts += "<tr>" + (Convert-OneNoteNode $child) + "</tr>" }
      "Cell" { $parts += "<td>" + (Convert-OneNoteNode $child) + "</td>" }
      "OEChildren" { $parts += Convert-OneNoteNode $child }
      "OE" {
        $body = Convert-OneNoteNode $child
        if ($child.SelectSingleNode("*[local-name()='List']/*[local-name()='Bullet']")) {
          $parts += "<ul><li>" + $body + "</li></ul>"
        } elseif ($child.SelectSingleNode("*[local-name()='List']/*[local-name()='Number']")) {
          $parts += "<ol><li>" + $body + "</li></ol>"
        } else {
          $parts += $body
        }
      }
      "Outline" { $parts += "<div>" + (Convert-OneNoteNode $child) + "</div>" }
    }
  }
  return ($parts -join "")
}

function Convert-OneNotePage([string]$Xml) {
  $document = New-Object System.Xml.XmlDocument
  $document.XmlResolver = $null
  $readerSettings = New-Object System.Xml.XmlReaderSettings
  $readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $readerSettings.XmlResolver = $null
  $stringReader = New-Object System.IO.StringReader($Xml)
  $reader = [System.Xml.XmlReader]::Create($stringReader, $readerSettings)
  try { $document.Load($reader) } finally { $reader.Dispose(); $stringReader.Dispose() }
  $warnings = @("Free-form positioning, images and ink are preserved in the PDF snapshot, not as editable content.")
  foreach ($kind in @("InsertedFile", "MediaFile", "InkDrawing", "InkWord", "Image", "Meta")) {
    $count = $document.SelectNodes("//*[local-name()='$kind']").Count
    if ($count -gt 0) {
      $warnings += "${count} ${kind} item(s): view visual content in the PDF; embedded files, audio, tags and metadata are not imported as separate editable objects."
    }
  }
  $html = Convert-OneNoteNode $document.DocumentElement
  return @{html = $html; warnings = @($warnings)}
}

function Export-OneNoteSection($OneNote, [string]$Source, [string]$Destination) {
  $sectionId = ""
  $OneNote.OpenHierarchy($Source, "", [ref]$sectionId, 0)
  $hierarchy = Invoke-OneNoteRead {
    $xml = ""
    $OneNote.GetHierarchy($sectionId, 4, [ref]$xml, 2)
    return $xml
  }
  $document = New-Object System.Xml.XmlDocument
  $document.XmlResolver = $null
  $document.LoadXml($hierarchy)
  $section = $document.SelectSingleNode("//*[local-name()='Section']")
  if (!$section) { throw "OneNote did not return a section. Export a single section as a .one file." }
  $pages = @($section.SelectNodes("*[local-name()='Page' and not(@isInRecycleBin='true')]"))
  if ($pages.Count -gt 500) { throw "This section contains more than 500 pages. Split it into smaller sections before importing." }
  $records = @()
  $index = 0
  $totalBytes = 0
  foreach ($page in $pages) {
    $pageXml = Invoke-OneNoteRead {
      $xml = ""
      $OneNote.GetPageContent($page.GetAttribute("ID"), [ref]$xml, 0, 2)
      return $xml
    }
    $converted = Convert-OneNotePage $pageXml
    if ($converted.html.Length -gt 900000) { throw "A page exceeds the editable content limit. Split it in OneNote before importing." }
    $pdfName = "page-$index.pdf"
    $pdfPath = Join-Path $Destination $pdfName
    $OneNote.Publish($page.GetAttribute("ID"), $pdfPath, 3, "")
    $pdfSize = (Get-Item -LiteralPath $pdfPath).Length
    if ($pdfSize -gt 20 * 1024 * 1024) { throw "A page's PDF snapshot exceeds 20 MB. Split it in OneNote before importing." }
    $totalBytes += $pdfSize
    if ($totalBytes -gt 500 * 1024 * 1024) { throw "PDF snapshots exceed 500 MB. Split the section before importing." }
    $title = $page.GetAttribute("name")
    if (!$title) { $title = "Untitled page" }
    $level = 1
    if ($page.GetAttribute("pageLevel")) { $level = [int]$page.GetAttribute("pageLevel") }
    $records += @{
      title = $title
      level = $level
      html = $converted.html
      warnings = $converted.warnings
      pdf = $pdfName
    }
    $index++
  }
  $manifest = @{title = $section.GetAttribute("name"); pages = @($records)}
  [System.IO.File]::WriteAllText((Join-Path $Destination "manifest.json"), ($manifest | ConvertTo-Json -Depth 8 -Compress), (New-Object System.Text.UTF8Encoding($false)))
}

if ($SourcePath -and $OutputDirectory) {
  $application = $null
  try {
    $application = New-Object -ComObject OneNote.Application
    Export-OneNoteSection $application $SourcePath $OutputDirectory
  } catch {
    [Console]::Error.WriteLine("OneNote export failed. Open the section in the Windows OneNote desktop app, unlock any protected pages, and retry. " + $_.Exception.Message)
    exit 1
  } finally {
    if ($application) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($application) }
  }
}
