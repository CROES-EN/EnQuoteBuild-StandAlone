$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\..\electron\oneNoteExport.ps1")
$xml = @'
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote">
<one:Title><one:OE><one:T>Not duplicated</one:T></one:OE></one:Title>
<one:Outline><one:OEChildren>
<one:OE><one:T><![CDATA[Hello <b>world</b> &amp; <a href="https://example.invalid">link</a>]]></one:T></one:OE>
<one:OE><one:List><one:Bullet/></one:List><one:T>Bullet</one:T></one:OE>
<one:OE><one:Table><one:Row><one:Cell><one:OEChildren><one:OE><one:T>Cell</one:T></one:OE></one:OEChildren></one:Cell></one:Row></one:Table></one:OE>
<one:OE><one:InsertedFile pathSource="do-not-read"/><one:Image/><one:InkDrawing/></one:OE>
</one:OEChildren></one:Outline>
</one:Page>
'@
$result = Convert-OneNotePage $xml
if (!$result.html.Contains("Hello <b>world</b>")) { throw "Rich text was not retained" }
if (!$result.html.Contains("<ul><li><p>Bullet</p></li></ul>")) { throw "Bullet list was not retained" }
if (!$result.html.Contains("<table><tr><td><p>Cell</p></td></tr></table>")) { throw "Table was not retained" }
if ($result.html.Contains("Not duplicated")) { throw "Title duplicated in content" }
if ($result.warnings.Count -lt 4) { throw "Unsupported content warnings missing" }
try {
  Convert-OneNotePage '<!DOCTYPE Page [<!ENTITY x SYSTEM "file:///private">]><Page>&x;</Page>'
  throw "DTD must be rejected"
} catch {
  if ($_.Exception.Message -eq "DTD must be rejected") { throw }
}
Write-Output "ok   OneNote XML converter: formatted text, links, lists, tables, warnings and DTD rejection"
