$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\..\electron\oneNoteExport.ps1")
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("enquote-onenote-native-" + [Guid]::NewGuid().ToString())
$notebookPath = Join-Path $root "ImportTestNotebook"
$outputPath = Join-Path $root "Output"
[void][System.IO.Directory]::CreateDirectory($outputPath)
$app = $null
$notebookId = ""
$closed = $false
try {
  $app = New-Object -ComObject OneNote.Application
  $app.OpenHierarchy($notebookPath, "", [ref]$notebookId, 1)
  $sectionId = ""
  $sectionPath = Join-Path $notebookPath "Synthetic Import.one"
  $app.OpenHierarchy($sectionPath, "", [ref]$sectionId, 3)
  $pageId = ""
  $app.CreateNewPage($sectionId, [ref]$pageId, 1)
  $pageXml = @"
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="$pageId">
<one:Title><one:OE><one:T><![CDATA[Synthetic import page]]></one:T></one:OE></one:Title>
<one:Outline><one:OEChildren><one:OE><one:T><![CDATA[Native <b>formatted</b> import test.]]></one:T></one:OE></one:OEChildren></one:Outline>
</one:Page>
"@
  $app.UpdatePageContent($pageXml, 0, 2, $false)
  $childId = ""
  $app.CreateNewPage($sectionId, [ref]$childId, 1)
  $childXml = @"
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="$childId">
<one:Title><one:OE><one:T><![CDATA[Synthetic subpage]]></one:T></one:OE></one:Title>
<one:Outline><one:OEChildren><one:OE><one:T><![CDATA[Subpage content.]]></one:T></one:OE></one:OEChildren></one:Outline>
</one:Page>
"@
  $app.UpdatePageContent($childXml, 0, 2, $false)
  $hierarchyXml = @"
<one:Section xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="$sectionId">
<one:Page ID="$pageId" pageLevel="1"/>
<one:Page ID="$childId" pageLevel="2"/>
</one:Section>
"@
  $app.UpdateHierarchy($hierarchyXml, 2)
  $exportedSectionPath = Join-Path $notebookPath "Exported Section.one"
  $app.Publish($sectionId, $exportedSectionPath, 0, "")
  & powershell.exe -NoProfile -NonInteractive -STA -File (Join-Path $PSScriptRoot "..\..\electron\oneNoteExport.ps1") -SourcePath $exportedSectionPath -OutputDirectory $outputPath
  if ($LASTEXITCODE -ne 0) { throw "The production OneNote export process failed" }
  $manifest = [System.IO.File]::ReadAllText((Join-Path $outputPath "manifest.json")) | ConvertFrom-Json
  if ($manifest.pages.Count -ne 2) { throw "Native export must contain two synthetic pages" }
  if ($manifest.pages[0].title -ne "Synthetic import page") { throw "Native export lost the page title" }
  if (!$manifest.pages[0].html.Contains("formatted")) { throw "Native export lost editable content" }
  if ($manifest.pages[1].level -ne 2) { throw "Native export lost subpage hierarchy" }
  $pdf = [System.IO.File]::ReadAllBytes((Join-Path $outputPath "page-0.pdf"))
  if ([System.Text.Encoding]::ASCII.GetString($pdf, 0, 5) -ne "%PDF-") { throw "Native export did not produce a PDF" }
  Write-Output ("ok   Native Windows OneNote: .one section reading, page/subpage hierarchy, editable content and PDF snapshots (" + $pdf.Length + " bytes)")
} finally {
  if ($app) {
    try {
      if ($notebookId) { $app.CloseNotebook($notebookId, $false); $closed = $true }
    } finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  }
  if ($closed) { [System.IO.Directory]::Delete($root, $true) }
  else { Write-Warning ("Synthetic test artifacts retained because notebook closure was not confirmed: " + $root) }
}
